import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';

import { getServerSettings } from './settings';

const LIKED_CACHE_KEY = 'musicdown.spotifyLiked';

export interface SpotifyLikedTrack {
  id: string;
  name: string;
  artists: string;
  album: string;
  image: string | null;
  url: string;
  addedAt: string;
}

export interface LikedSnapshot {
  total: number;
  tracks: SpotifyLikedTrack[];
  /** Momento en que la extensión Spicetify envió la lista al servidor. */
  syncedAt: number;
}

// Las versiones anteriores de la extensión enviaban "spotify:image:<id>" en vez de una URL.
function normalizeImage(image: string | null): string | null {
  if (!image) return null;
  const match = /^spotify:image:([A-Za-z0-9]+)$/.exec(image);
  return match ? `https://i.scdn.co/image/${match[1]}` : image;
}

function normalizeSnapshot(snapshot: LikedSnapshot): LikedSnapshot {
  return { ...snapshot, tracks: snapshot.tracks.map((t) => ({ ...t, image: normalizeImage(t.image) })) };
}

// Copia local de la última lista recibida, para poder listar los likes aunque el servidor no responda.
// Se guarda en un archivo y no en AsyncStorage: en Android, AsyncStorage falla al leer valores de más
// de ~2 MB, y una biblioteca grande puede superar ese tamaño.
function cacheFile(): File {
  return new File(Paths.document, 'spotify-liked.json');
}

async function writeCache(snapshot: LikedSnapshot): Promise<void> {
  try {
    cacheFile().write(JSON.stringify(snapshot));
  } catch {
    // Si no se puede escribir la caché, la lista igual se muestra; solo no habrá copia offline.
  }
}

export async function getCachedLiked(): Promise<LikedSnapshot | null> {
  try {
    const file = cacheFile();
    if (file.exists) {
      return normalizeSnapshot(JSON.parse(await file.text()) as LikedSnapshot);
    }
    // Migración: versiones anteriores guardaban la lista en AsyncStorage.
    const legacy = await AsyncStorage.getItem(LIKED_CACHE_KEY);
    if (!legacy) return null;
    const snapshot = normalizeSnapshot(JSON.parse(legacy) as LikedSnapshot);
    await writeCache(snapshot);
    await AsyncStorage.removeItem(LIKED_CACHE_KEY);
    return snapshot;
  } catch {
    return null;
  }
}

/**
 * Los likes los publica la extensión Spicetify (spicetify/musicdown-likes.js) en el servidor,
 * porque la Web API oficial exige Premium al dueño de la app. Aquí solo se leen.
 */
export async function fetchLikedTracks(): Promise<LikedSnapshot> {
  const { serverUrl, apiKey } = await getServerSettings();
  const base = serverUrl.replace(/\/+$/, '');
  if (!base) {
    throw new Error('Configura la URL del servidor en Ajustes.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch(`${base}/api/spotify-likes`, {
      headers: apiKey ? { 'x-api-key': apiKey } : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new Error('No se pudo conectar al servidor.');
  } finally {
    clearTimeout(timeout);
  }
  if (response.status === 404) {
    throw new Error('El servidor aún no recibió likes. Abre Spotify en la laptop y pulsa el botón de musicdown.');
  }
  if (!response.ok) {
    throw new Error(`El servidor respondió con error ${response.status}.`);
  }
  const snapshot = normalizeSnapshot((await response.json()) as LikedSnapshot);
  await writeCache(snapshot);
  return snapshot;
}

// ---- Eliminar likes (desde el reproductor) ----

const PENDING_REMOVALS_KEY = 'musicdown.pendingLikeRemovals';

async function sendLikeRemoval(id: string): Promise<boolean> {
  const { serverUrl, apiKey } = await getServerSettings();
  const base = serverUrl.trim().replace(/\/+$/, '');
  if (!base) return false;
  try {
    const response = await fetch(`${base}/api/spotify-likes/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: apiKey ? { 'x-api-key': apiKey } : undefined,
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function readPendingRemovals(): Promise<string[]> {
  try {
    return JSON.parse((await AsyncStorage.getItem(PENDING_REMOVALS_KEY)) ?? '[]') as string[];
  } catch {
    return [];
  }
}

/**
 * Quita un like de la lista local y del servidor (que lo recuerda para que no vuelva con la próxima
 * sincronización). No cambia tu biblioteca de Spotify. Si el servidor no responde, queda pendiente.
 */
export async function removeLikedTrack(id: string): Promise<void> {
  await removeLikedTracks([id]);
}

/** Igual que removeLikedTrack pero para varios: la caché se escribe una vez y el servidor recibe las bajas por tandas. */
export async function removeLikedTracks(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const gone = new Set(ids);
  const cached = await getCachedLiked();
  if (cached) {
    const tracks = cached.tracks.filter((t) => !gone.has(t.id));
    await writeCache({ ...cached, tracks, total: tracks.length });
  }
  const failed: string[] = [];
  for (let i = 0; i < ids.length; i += 6) {
    const chunk = ids.slice(i, i + 6);
    const results = await Promise.all(chunk.map((id) => sendLikeRemoval(id)));
    results.forEach((ok, k) => {
      if (!ok) failed.push(chunk[k]);
    });
  }
  if (failed.length > 0) {
    const pending = await readPendingRemovals();
    const merged = [...new Set([...pending, ...failed])];
    await AsyncStorage.setItem(PENDING_REMOVALS_KEY, JSON.stringify(merged)).catch(() => {});
  }
}

/** Envía al servidor las eliminaciones que quedaron pendientes por estar sin conexión. */
export async function flushPendingLikeRemovals(): Promise<void> {
  const pending = await readPendingRemovals();
  if (pending.length === 0) return;
  const stillPending: string[] = [];
  for (const id of pending) {
    if (!(await sendLikeRemoval(id))) stillPending.push(id);
  }
  await AsyncStorage.setItem(PENDING_REMOVALS_KEY, JSON.stringify(stillPending)).catch(() => {});
}
