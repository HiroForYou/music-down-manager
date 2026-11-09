import { Directory, File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { Asset as NextAsset } from 'expo-media-library/next';

import { writeMp3Tags } from './id3';
import { readId3 } from './id3Read';
import { addTrack, getTrack, listTracks, removeTrack, updateTrack } from './library';
import { detectLinkKind } from './linkKind';
import { getHideDownloads } from './privacy';
import { emitTrackDeleted } from './trackEvents';
import { getServerSettings } from './settings';
import type { SpotifyLikedTrack } from './spotify';
import type { Track } from './types';

/**
 * Extensión "disfrazada" (ROT13 de "mp3") para las descargas ocultas: los archivos siguen siendo MP3 y
 * suenan igual (el reproductor detecta el formato por el contenido), pero otras apps no los reconocen.
 */
export const HIDDEN_EXTENSION = '.zc3';

function generateId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '').trim();
  return cleaned.slice(0, 80) || 'track';
}

function ensureDirectory(dir: Directory): Directory {
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  return dir;
}

function tracksDirectory(): Directory {
  return ensureDirectory(new Directory(Paths.document, 'tracks'));
}

function tempDirectory(): Directory {
  return ensureDirectory(new Directory(Paths.cache, 'musicdown-tmp'));
}

function uniqueFile(dir: Directory, baseName: string, extension: string): File {
  let candidate = new File(dir, `${baseName}${extension}`);
  let attempt = 1;
  while (candidate.exists) {
    attempt += 1;
    candidate = new File(dir, `${baseName} (${attempt})${extension}`);
  }
  return candidate;
}

export interface YoutubeMetadata {
  title: string | null;
  artist: string | null;
  thumbnail: string | null;
}

function requireServerUrl(serverUrl: string): string {
  if (!serverUrl) {
    throw new Error('Configura la URL del servidor en Ajustes para descargar enlaces de YouTube.');
  }
  return serverUrl.replace(/\/+$/, '');
}

export async function fetchYoutubeMetadata(sourceUrl: string): Promise<YoutubeMetadata> {
  const { serverUrl, apiKey } = await getServerSettings();
  const base = requireServerUrl(serverUrl);
  const endpoint = `${base}/api/metadata?url=${encodeURIComponent(sourceUrl)}`;
  const response = await fetch(endpoint, {
    headers: apiKey ? { 'x-api-key': apiKey } : undefined,
  });
  if (!response.ok) {
    throw new Error(`No se pudo obtener información del video (${response.status})`);
  }
  return response.json();
}

async function pollJobProgress(
  base: string,
  apiKey: string,
  jobId: string,
  onProgress: (percent: number) => void,
  shouldContinue: () => boolean
): Promise<void> {
  while (shouldContinue()) {
    try {
      const response = await fetch(`${base}/api/progress?jobId=${jobId}`, {
        headers: apiKey ? { 'x-api-key': apiKey } : undefined,
      });
      if (response.ok) {
        const data = await response.json();
        if (typeof data.percent === 'number') onProgress(data.percent);
      }
    } catch {
      // Ignore transient polling errors — the main download request is authoritative.
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
}

async function explainDownloadFailure(base: string, apiKey: string, cause: unknown): Promise<string> {
  const detail = cause instanceof Error ? cause.message : String(cause);
  try {
    const health = await fetch(`${base}/api/health`);
    if (!health.ok) return `El servidor respondió ${health.status} al comprobar su estado.`;
  } catch {
    return `No se pudo conectar con el servidor (${base}). ¿Está encendido y la URL de Ajustes es la actual?`;
  }
  try {
    const auth = await fetch(`${base}/api/progress?jobId=check`, { headers: apiKey ? { 'x-api-key': apiKey } : undefined });
    if (auth.status === 401) return 'El servidor rechazó la clave de acceso. Revisa la "Clave de acceso" en Ajustes.';
  } catch {
    // Ya se comprobó que el servidor responde.
  }
  return `La descarga falló: ${detail}`;
}

async function downloadYoutubeAudio(
  sourceUrl: string,
  destination: Directory,
  filenameHint: string,
  onProgress?: (percent: number) => void
): Promise<File> {
  const { serverUrl, apiKey } = await getServerSettings();
  const base = requireServerUrl(serverUrl);
  const jobId = generateId();
  const endpoint = `${base}/api/convert?url=${encodeURIComponent(sourceUrl)}&filename=${encodeURIComponent(filenameHint)}&jobId=${jobId}`;

  let polling = true;
  const pollPromise = onProgress
    ? pollJobProgress(base, apiKey, jobId, onProgress, () => polling)
    : Promise.resolve();

  try {
    // fetch (y no File.downloadFileAsync): este último corta a los ~10 s sin recibir bytes y el servidor
    // tarda más que eso en empezar a enviar el MP3 (yt-dlp busca y descarga, ffmpeg convierte).
    const response = await fetch(endpoint, { headers: apiKey ? { 'x-api-key': apiKey } : undefined });
    if (!response.ok) throw new Error(`El servidor respondió ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0) throw new Error('El servidor devolvió un archivo vacío');
    const file = new File(destination, `${jobId}.mp3`);
    if (file.exists) file.delete();
    file.create();
    file.write(bytes);
    return file;
  } catch (e) {
    // downloadFileAsync solo dice "rejected": se comprueba qué falló realmente (servidor, clave o conversión).
    throw new Error(await explainDownloadFailure(base, apiKey, e));
  } finally {
    polling = false;
    await pollPromise;
  }
}

export async function downloadImageBytes(url: string): Promise<Uint8Array | null> {
  try {
    const destination = new File(tempDirectory(), `cover-${generateId()}.jpg`);
    const downloaded = await File.downloadFileAsync(url, destination, { idempotent: true });
    const bytes = await downloaded.bytes();
    downloaded.delete();
    return bytes;
  } catch (e) {
    console.warn('downloadImageBytes: failed for', url, '-', e instanceof Error ? e.message : e);
    return null;
  }
}

export function extractYoutubeVideoId(sourceUrl: string): string | null {
  try {
    const parsed = new URL(sourceUrl);
    if (parsed.hostname.includes('youtu.be')) {
      return parsed.pathname.slice(1) || null;
    }
    const v = parsed.searchParams.get('v');
    if (v) return v;
    const shortsMatch = parsed.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
    if (shortsMatch) return shortsMatch[1];
  } catch {
    // Not a parseable URL — no fallback thumbnail possible.
  }
  return null;
}

async function fetchYoutubeCoverBytes(sourceUrl: string, thumbnailUrl: string | null): Promise<Uint8Array | undefined> {
  if (thumbnailUrl) {
    const bytes = await downloadImageBytes(thumbnailUrl);
    if (bytes) return bytes;
  }
  // yt-dlp's chosen thumbnail URL (often maxresdefault.jpg) doesn't exist for
  // every video. hqdefault.jpg is available for virtually all YouTube videos,
  // so fall back to it before giving up on a cover entirely.
  const videoId = extractYoutubeVideoId(sourceUrl);
  if (videoId) {
    const bytes = await downloadImageBytes(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);
    if (bytes) return bytes;
  }
  return undefined;
}

async function publishToMediaLibrary(file: File): Promise<string | null> {
  // We only ever create new assets, never read the user's existing library,
  // so request write-only access. This avoids the granular 'audio' read
  // permission, which isn't declared in Expo Go's manifest (only a real
  // native build honors the config plugin that would add it).
  const permission = await MediaLibrary.requestPermissionsAsync(true);
  if (!permission.granted) return null;

  // No album grouping: createAlbumAsync does raw File I/O to create the
  // album's directory, which needs a real WRITE_EXTERNAL_STORAGE grant that
  // modern Android (13+) won't give out anymore. createAssetAsync alone uses
  // the modern MediaStore insert path and drops the file into the default
  // Music/ location for its media type without hitting that wall.
  const asset = await MediaLibrary.createAssetAsync(file.uri);
  return asset.id;
}

async function unpublishFromMediaLibrary(mediaAssetId: string | null): Promise<void> {
  if (!mediaAssetId) return;
  try {
    await MediaLibrary.deleteAssetsAsync([mediaAssetId]);
  } catch {
    // Asset may already be gone (deleted externally) — safe to ignore.
  }
}

export interface ExternalAudioItem {
  mediaAssetId: string;
  title: string;
  artist: string;
  fileUri: string;
  /** Extensión del archivo original en minúsculas, sin punto (p. ej. "mp3"). */
  extension: string;
}

/**
 * Lists every audio file in the device's Music folder, including ones this
 * app didn't download. Requires real read access to audio (`READ_MEDIA_AUDIO`
 * on Android 13+), which Expo Go cannot grant — only a development build
 * (whose native manifest actually includes the config-plugin permissions)
 * can use this.
 */
export async function listAllMusicFolderAudio(excludeMediaAssetIds: Set<string>): Promise<ExternalAudioItem[]> {
  const permission = await MediaLibrary.requestPermissionsAsync(false, ['audio']);
  if (!permission.granted) {
    throw new Error(
      'Se necesita permiso de lectura de audio. Esto requiere un development build — no funciona en Expo Go.'
    );
  }

  let album: MediaLibrary.Album | null = null;
  try {
    album = await MediaLibrary.getAlbumAsync('Music');
  } catch {
    album = null;
  }

  // Se leen todas las páginas (antes solo las primeras 500, y la lista se quedaba corta).
  const assets: MediaLibrary.Asset[] = [];
  let after: string | undefined;
  for (let page = 0; page < 200; page++) {
    const result = await MediaLibrary.getAssetsAsync({
      mediaType: 'audio',
      album: album ?? undefined,
      first: 500,
      after,
      sortBy: [['creationTime', false]],
    });
    assets.push(...result.assets);
    if (!result.hasNextPage) break;
    after = result.endCursor;
  }

  return assets
    .filter((asset) => !excludeMediaAssetIds.has(asset.id))
    .map((asset) => ({
      mediaAssetId: asset.id,
      title: asset.filename.replace(/\.[^.]+$/, ''),
      artist: 'Desconocido',
      fileUri: asset.uri,
      extension: (asset.filename.split('.').pop() ?? '').toLowerCase(),
    }));
}

/** ¿Ya hay permiso de lectura de audio? (sin preguntar). Sirve para refrescar el escaneo en silencio. */
export async function hasAudioPermission(): Promise<boolean> {
  try {
    return (await MediaLibrary.getPermissionsAsync(false, ['audio'])).granted;
  } catch {
    return false;
  }
}

export interface MoveResult {
  /** Canciones que ahora viven en la carpeta Música como .mp3 (ya no ocupan espacio dos veces). */
  moved: number;
  /** Se publicaron en Música, pero la copia privada se conservó porque no se pudo verificar el archivo nuevo. */
  keptCopy: number;
  skipped: number;
  errors: string[];
}

/**
 * Mueve descargas de la app a la carpeta Música del teléfono como archivos .mp3 normales (las ocultas .zc3
 * dejan de serlo). La canción sigue en la biblioteca, ahora apuntando al archivo de Música. El archivo
 * privado solo se borra después de comprobar que la copia nueva existe y pesa lo mismo.
 */
export async function moveTracksToMusic(ids: string[], onProgress?: (done: number, total: number) => void): Promise<MoveResult> {
  const result: MoveResult = { moved: 0, keptCopy: 0, skipped: 0, errors: [] };
  const permission = await MediaLibrary.requestPermissionsAsync(true);
  if (!permission.granted) throw new Error('Falta el permiso para guardar en la carpeta Música.');

  let done = 0;
  for (const id of ids) {
    const track = await getTrack(id);
    done += 1;
    if (!track || track.inMusic) {
      result.skipped += 1;
      onProgress?.(done, ids.length);
      continue;
    }
    try {
      const source = new File(track.fileUri);
      if (!source.exists) throw new Error('el archivo ya no existe');

      // Si ya se había publicado una copia (descargas no ocultas), se reutiliza en vez de duplicarla otra vez.
      let assetId = track.mediaAssetId;
      let publicUri: string | null = null;
      if (assetId) {
        try {
          publicUri = (await MediaLibrary.getAssetInfoAsync(assetId))?.localUri ?? null;
        } catch {
          publicUri = null;
        }
        if (!publicUri) assetId = null;
      }
      if (!assetId) {
        // Se publica con nombre "Título.mp3" (el nombre del archivo es el que verá cualquier otra app).
        const temp = uniqueFile(tempDirectory(), sanitizeFilename(track.title), '.mp3');
        source.copy(temp);
        try {
          const asset = await MediaLibrary.createAssetAsync(temp.uri);
          assetId = asset.id;
          publicUri = asset.uri;
        } finally {
          try {
            if (temp.exists) temp.delete();
          } catch {
            // La caché se limpia sola.
          }
        }
      }

      let verified = false;
      if (publicUri) {
        try {
          const published = new File(publicUri);
          verified = published.exists && published.size === source.size;
        } catch {
          verified = false;
        }
      }
      if (verified && publicUri) {
        await updateTrack(id, { fileUri: publicUri, mediaAssetId: assetId, inMusic: true });
        try {
          source.delete();
        } catch {
          // Si no se pudo borrar, solo queda un archivo huérfano en el almacenamiento privado.
        }
        result.moved += 1;
      } else {
        await updateTrack(id, { mediaAssetId: assetId });
        result.keptCopy += 1;
      }
    } catch (e) {
      result.errors.push(`"${track.title}": ${e instanceof Error ? e.message : String(e)}`);
    }
    onProgress?.(done, ids.length);
  }
  return result;
}

/** El id de MediaLibrary es solo el número; la API "next" exige la URI de contenido del archivo. */
function audioContentUri(mediaAssetId: string): string {
  return /^content:/.test(mediaAssetId) ? mediaAssetId : `content://media/external/audio/media/${mediaAssetId}`;
}

/**
 * Elimina archivos de audio que la app no creó. Android pide una confirmación del sistema, y con varios
 * archivos en una sola llamada aparece un único diálogo para todo el lote.
 */
export async function deleteExternalAssets(mediaAssetIds: string[]): Promise<void> {
  if (mediaAssetIds.length === 0) return;
  // Permiso de audio: si no está concedido se pide aquí; si el sistema ya no deja preguntar, hay que
  // concederlo a mano en Ajustes del teléfono.
  const permission = await MediaLibrary.requestPermissionsAsync(false, ['audio']);
  if (!permission.granted) {
    throw new Error(
      'Falta el permiso de música y audio. Concédelo en Ajustes del teléfono > Apps > MusicDown > Permisos > Música y audio.'
    );
  }
  // The legacy deleteAssetsAsync() doesn't implement Android 11+'s required
  // user-consent flow for deleting media this app doesn't own (files found
  // via the "Todas" scan) — it can silently no-op instead of deleting.
  // The "next" API's Asset.delete() properly triggers the system
  // confirmation dialog via MediaStore.createDeleteRequest(). On Android 14+
  // its permission check also required READ_MEDIA_VISUAL_USER_SELECTED, which
  // can only be granted through the photo/video picker flow and is therefore
  // impossible to satisfy for an audio-only app — patched out via pnpm
  // (patches/expo-media-library.patch).
  try {
    await NextAsset.delete(mediaAssetIds.map((id) => new NextAsset(audioContentUri(id))));
  } catch (e) {
    // Tras aceptar el diálogo, el sistema ya borró los archivos; la librería intenta borrarlos otra vez y
    // falla con SecurityException ("has no access to ..."). Si realmente ya no existen, el borrado funcionó.
    const stillThere: string[] = [];
    for (const id of mediaAssetIds) {
      try {
        const info = await MediaLibrary.getAssetInfoAsync(id);
        if (info) stillThere.push(id);
      } catch {
        // No se puede consultar: se asume que ya no existe (si existiera, la consulta habría respondido).
      }
    }
    if (stillThere.length > 0) throw e;
  }
}

export async function deleteExternalAsset(mediaAssetId: string): Promise<void> {
  await deleteExternalAssets([mediaAssetId]);
}

/** "Artista - Título" -> {artist, title}; si no sigue ese patrón, todo es el título. */
function parseFilename(name: string): { title: string; artist: string } {
  const match = /^(.+?)\s+[-–]\s+(.+)$/.exec(name);
  return match ? { artist: match[1].trim(), title: match[2].trim() } : { title: name.trim() || 'Pista sin título', artist: 'Desconocido' };
}

/**
 * Importa un MP3 de la carpeta Música (que la app no creó y por eso no puede editar) como copia propia de la
 * app, con título, artista y portada editables. El original no se toca: el borrado, si se quiere, es aparte.
 */
export async function importExternalTrack(item: ExternalAudioItem): Promise<Track> {
  if (item.extension !== 'mp3') {
    throw new Error(`Solo se pueden importar archivos MP3 ("${item.title}" es .${item.extension || '?'}).`);
  }
  const temp = new File(tempDirectory(), `import-${generateId()}.mp3`);
  new File(item.fileUri).copy(temp);
  // Se conservan las etiquetas y la portada que el archivo ya traía; el nombre del archivo solo es respaldo.
  const tags = await readId3(item.fileUri);
  const fromName = parseFilename(item.title);
  return finalizeTrack({
    id: generateId(),
    title: tags?.title ?? fromName.title,
    artist: tags?.artist ?? fromName.artist,
    album: tags?.album ?? '',
    coverBytes: tags?.cover?.bytes,
    sourceUrl: `import:${item.mediaAssetId}`,
    downloadedFile: temp,
  });
}

export async function downloadTrack(sourceUrl: string, onProgress?: (percent: number) => void): Promise<Track> {
  const kind = detectLinkKind(sourceUrl);
  const id = generateId();
  const temp = tempDirectory();

  let title = 'Pista sin título';
  let artist = 'Desconocido';
  let coverBytes: Uint8Array | undefined;
  let downloadedFile: File;

  if (kind === 'youtube') {
    const metadata = await fetchYoutubeMetadata(sourceUrl).catch(() => null);
    if (metadata?.title) title = metadata.title;
    if (metadata?.artist) artist = metadata.artist;
    coverBytes = await fetchYoutubeCoverBytes(sourceUrl, metadata?.thumbnail ?? null);
    downloadedFile = await downloadYoutubeAudio(sourceUrl, temp, sanitizeFilename(title), onProgress);
  } else {
    downloadedFile = (await File.downloadFileAsync(sourceUrl, temp, { idempotent: true })) as File;
    const guessedName = downloadedFile.name.replace(/\.[^.]+$/, '');
    if (guessedName) title = guessedName;
  }

  return finalizeTrack({ id, title, artist, album: '', coverBytes, sourceUrl, downloadedFile });
}

interface FinalizeInput {
  id: string;
  title: string;
  artist: string;
  album: string;
  coverBytes?: Uint8Array;
  sourceUrl: string;
  downloadedFile: File;
  spotifyId?: string;
}

/** Etiqueta el MP3 descargado, lo guarda (público o disfrazado, según Ajustes) y lo registra en la biblioteca. */
async function finalizeTrack(input: FinalizeInput): Promise<Track> {
  const { id, title, artist, album, coverBytes, sourceUrl, downloadedFile, spotifyId } = input;

  const rawBytes = await downloadedFile.bytes();
  downloadedFile.delete();

  const taggedBytes = writeMp3Tags(rawBytes, { title, artist, album: album || undefined, coverBytes });

  // Ocultas (por defecto): almacenamiento privado de la app, extensión disfrazada y sin publicar en la
  // biblioteca multimedia del teléfono, así que ninguna otra app las ve.
  const hidden = getHideDownloads();
  const finalFile = uniqueFile(tracksDirectory(), sanitizeFilename(title), hidden ? HIDDEN_EXTENSION : '.mp3');
  finalFile.create();
  finalFile.write(taggedBytes);

  let coverUri: string | null = null;
  if (coverBytes) {
    const coverFile = new File(tracksDirectory(), `${id}-cover.jpg`);
    if (coverFile.exists) coverFile.delete();
    coverFile.create();
    coverFile.write(coverBytes);
    coverUri = coverFile.uri;
  }

  const mediaAssetId = hidden ? null : await publishToMediaLibrary(finalFile);

  const track: Track = {
    id,
    title,
    artist,
    album,
    coverUri,
    fileUri: finalFile.uri,
    mediaAssetId,
    sourceUrl,
    createdAt: Date.now(),
    ...(spotifyId ? { spotifyId } : {}),
  };

  await addTrack(track);
  return track;
}

/** Descarga un like de Spotify buscando "artista título" en YouTube (vía el servidor). */
export async function downloadSpotifyLike(like: SpotifyLikedTrack, onProgress?: (percent: number) => void): Promise<Track> {
  const id = generateId();
  const temp = tempDirectory();
  // La portada de 640 px de Spotify (las listas usan variantes pequeñas).
  const coverUrl = like.image ? like.image.replace(/ab67616d0000(1e02|4851)/, 'ab67616d0000b273') : null;
  const coverBytes = coverUrl ? (await downloadImageBytes(coverUrl)) ?? undefined : undefined;
  const query = `ytsearch1:${like.artists} ${like.name}`;
  const downloadedFile = await downloadYoutubeAudio(query, temp, sanitizeFilename(`${like.artists} - ${like.name}`), onProgress);
  return finalizeTrack({
    id,
    title: like.name,
    artist: like.artists,
    album: like.album,
    coverBytes,
    sourceUrl: like.url,
    downloadedFile,
    spotifyId: like.id,
  });
}

export interface MetadataPatch {
  title: string;
  artist: string;
  album?: string;
  coverBytes?: Uint8Array;
}

export async function updateTrackMetadata(id: string, patch: MetadataPatch): Promise<Track> {
  const existing = await getTrack(id);
  if (!existing) {
    throw new Error('Pista no encontrada');
  }

  const file = new File(existing.fileUri);
  const rawBytes = await file.bytes();

  let coverBytesForTag = patch.coverBytes;
  if (!coverBytesForTag && existing.coverUri) {
    coverBytesForTag = await new File(existing.coverUri).bytes();
  }

  const taggedBytes = writeMp3Tags(rawBytes, {
    title: patch.title,
    artist: patch.artist,
    album: patch.album,
    coverBytes: coverBytesForTag,
  });
  file.write(taggedBytes);

  let coverUri = existing.coverUri;
  if (patch.coverBytes) {
    const coverFile = new File(tracksDirectory(), `${id}-cover.jpg`);
    if (coverFile.exists) coverFile.delete();
    coverFile.create();
    coverFile.write(patch.coverBytes);
    coverUri = coverFile.uri;
  }

  // Las descargas ocultas nunca se publican en la biblioteca multimedia.
  const hidden = existing.fileUri.endsWith(HIDDEN_EXTENSION);
  let mediaAssetId = existing.mediaAssetId;
  if (!hidden && !existing.inMusic) {
    await unpublishFromMediaLibrary(existing.mediaAssetId);
    mediaAssetId = await publishToMediaLibrary(file);
  }

  const updated = await updateTrack(id, {
    title: patch.title,
    artist: patch.artist,
    album: patch.album ?? existing.album,
    coverUri,
    mediaAssetId,
  });
  if (!updated) {
    throw new Error('No se pudo actualizar la pista');
  }
  return updated;
}

export async function deleteTrack(id: string): Promise<void> {
  const existing = await getTrack(id);
  if (!existing) return;

  // Si el archivo vive en Música, se quita primero de la biblioteca multimedia (que lo borra del teléfono).
  if (existing.inMusic) await unpublishFromMediaLibrary(existing.mediaAssetId);
  try {
    new File(existing.fileUri).delete();
  } catch {
    // Already removed from disk — nothing to do.
  }
  if (existing.coverUri) {
    try {
      new File(existing.coverUri).delete();
    } catch {
      // Already removed from disk — nothing to do.
    }
  }
  if (!existing.inMusic) await unpublishFromMediaLibrary(existing.mediaAssetId);
  await removeTrack(id);
  emitTrackDeleted(id);
}

export async function clearLibrary(): Promise<void> {
  const tracks = await listTracks();
  for (const track of tracks) {
    await deleteTrack(track.id);
  }
}
