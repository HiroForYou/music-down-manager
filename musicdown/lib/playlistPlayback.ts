import type { PlayerItem } from './backgroundPlayer';
import { listTracks } from './library';
import type { PlaylistEntry } from './playlists';

// Convierte las entradas de una lista en elementos de la cola del reproductor.
// - Si la canción está descargada (por id o por id de Spotify), suena desde el archivo local.
// - Si es un archivo externo, suena desde su ruta.
// - Si solo se conoce por Spotify, suena en streaming (o con el respaldo).
// Las que ya no existen (p. ej. tras reinstalar) se omiten.

export interface ResolvedEntry {
  item: PlayerItem;
  entry: PlaylistEntry;
}

export async function resolveEntries(entries: PlaylistEntry[]): Promise<ResolvedEntry[]> {
  const tracks = await listTracks();
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const bySpotify = new Map(tracks.filter((t) => t.spotifyId).map((t) => [t.spotifyId as string, t]));

  const out: ResolvedEntry[] = [];
  for (const entry of entries) {
    const local = (entry.trackId ? byId.get(entry.trackId) : undefined) ?? (entry.spotifyId ? bySpotify.get(entry.spotifyId) : undefined);
    if (local) {
      out.push({
        entry,
        item: {
          id: `app:${local.id}`,
          title: local.title,
          artist: local.artist,
          image: local.coverUri ?? entry.image,
          kind: 'local',
          fileUri: local.fileUri,
          spotifyId: local.spotifyId,
        },
      });
    } else if (entry.assetId && entry.fileUri) {
      out.push({
        entry,
        item: { id: `ext:${entry.assetId}`, title: entry.title, artist: entry.artist, image: entry.image, kind: 'local', fileUri: entry.fileUri },
      });
    } else if (entry.spotifyId) {
      out.push({
        entry,
        item: { id: entry.spotifyId, title: entry.title, artist: entry.artist, image: entry.image, kind: 'spotify', spotifyId: entry.spotifyId },
      });
    }
  }
  return out;
}

/** ¿Se puede reproducir esta entrada? (descarga existente, archivo externo o canción de Spotify). */
export function isEntryAvailable(entry: PlaylistEntry, localTrackIds: ReadonlySet<string>): boolean {
  if (entry.spotifyId || (entry.assetId && entry.fileUri)) return true;
  return entry.trackId !== undefined && localTrackIds.has(entry.trackId);
}
