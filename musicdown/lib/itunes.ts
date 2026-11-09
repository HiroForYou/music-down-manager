import { getPowerPrefs } from './powerPrefs';

export interface CoverResult {
  id: string;
  title: string;
  artist: string;
  /** Small (100x100) artwork — use this for list thumbnails, it's cheap to load. */
  thumbnailUrl: string;
  /** Full-res (600x600) artwork — only fetch this for the track actually selected. */
  artworkUrl: string;
}

interface ITunesRawResult {
  collectionId?: number;
  trackId?: number;
  collectionName?: string;
  trackName?: string;
  artistName?: string;
  artworkUrl100?: string;
}

export async function searchCovers(query: string): Promise<CoverResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  if (getPowerPrefs().offlineMode) throw new Error('Modo sin conexión activado: no se pueden buscar portadas.');

  const url = `https://itunes.apple.com/search?media=music&entity=album&limit=12&term=${encodeURIComponent(trimmed)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Búsqueda de portadas falló (${response.status})`);
  }
  const json = (await response.json()) as { results?: ITunesRawResult[] };
  const results = json.results ?? [];

  return results
    .filter((r) => Boolean(r.artworkUrl100))
    .map((r) => ({
      id: String(r.collectionId ?? r.trackId ?? r.artworkUrl100),
      title: r.collectionName ?? r.trackName ?? trimmed,
      artist: r.artistName ?? '',
      thumbnailUrl: String(r.artworkUrl100),
      artworkUrl: String(r.artworkUrl100).replace('100x100bb', '600x600bb'),
    }));
}
