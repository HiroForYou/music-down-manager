import AsyncStorage from '@react-native-async-storage/async-storage';

import { getPowerPrefs } from './powerPrefs';

// Letras desde LRCLIB (https://lrclib.net): API pública y gratuita, sin clave. Se envían el título y el
// artista de la canción que suena; devuelve letra sincronizada (LRC) cuando existe, o letra plana.

export interface LyricLine {
  time: number;
  text: string;
}

export interface Lyrics {
  /** Letra con tiempos, para resaltar la línea actual. */
  synced: LyricLine[] | null;
  /** Letra sin tiempos (respaldo). */
  plain: string | null;
  instrumental: boolean;
}

const CACHE_PREFIX = 'musicdown.lyrics.';
const memory = new Map<string, Lyrics | null>();

/** Quita ruido típico de los títulos de YouTube: (Official Video), [HD], feat., Remastered… */
function cleanTitle(title: string): string {
  return title
    .replace(/[\(\[][^)\]]*(official|video|audio|lyrics?|letra|hd|4k|remaster|live|clip)[^)\]]*[\)\]]/gi, '')
    .replace(/\s+-\s+(remaster(ed)?|single|live|official).*$/i, '')
    .replace(/\s*[\(\[]?(feat\.?|ft\.?|con)\s[^)\]]*[\)\]]?$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Si el título viene como "Artista - Canción", separa ambas partes. */
function splitArtistTitle(title: string, artist: string): { title: string; artist: string } {
  const m = /^(.+?)\s+[-–]\s+(.+)$/.exec(title);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { title, artist };
}

export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (stamps.length === 0) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const s of stamps) {
      const frac = s[3] ? Number(`0.${s[3]}`) : 0;
      lines.push({ time: Number(s[1]) * 60 + Number(s[2]) + frac, text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

interface LrclibRecord {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  instrumental?: boolean;
  trackName?: string;
  artistName?: string;
  duration?: number;
}

function toLyrics(rec: LrclibRecord): Lyrics | null {
  const synced = rec.syncedLyrics ? parseLrc(rec.syncedLyrics) : null;
  const plain = rec.plainLyrics?.trim() || null;
  if (!synced?.length && !plain && !rec.instrumental) return null;
  return { synced: synced?.length ? synced : null, plain, instrumental: Boolean(rec.instrumental) };
}

interface NetStats {
  requests: number;
  failures: number;
}

/**
 * GET con tiempo de espera (fetch en React Native no tiene uno y una petición colgada dejaba la letra
 * "buscando" para siempre). 404 = no hay letra (no es un fallo); cualquier otro error o el tiempo agotado cuenta
 * como fallo de red.
 */
async function getJson(url: string, signal: AbortSignal | undefined, stats: NetStats, timeoutMs: number): Promise<unknown | null> {
  stats.requests++;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (response.status === 404) return null;
    if (!response.ok) {
      stats.failures++;
      return null;
    }
    return await response.json();
  } catch {
    if (!signal?.aborted) stats.failures++;
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function fetchLyrics(
  rawTitle: string,
  rawArtist: string,
  duration: number,
  cacheKey: string,
  signal?: AbortSignal
): Promise<Lyrics | null> {
  if (memory.has(cacheKey)) return memory.get(cacheKey) ?? null;
  try {
    const stored = await AsyncStorage.getItem(CACHE_PREFIX + cacheKey);
    if (stored) {
      const parsed = JSON.parse(stored) as Lyrics;
      memory.set(cacheKey, parsed);
      return parsed;
    }
  } catch {
    // Sin caché: se consulta la red.
  }

  // Modo sin conexión: solo se muestran las letras ya guardadas en el teléfono.
  if (getPowerPrefs().offlineMode) throw new Error('offline');

  const guesses = [
    { title: cleanTitle(rawTitle), artist: rawArtist },
    (() => {
      const s = splitArtistTitle(cleanTitle(rawTitle), rawArtist);
      return { title: s.title, artist: s.artist };
    })(),
  ];

  const stats: NetStats = { requests: 0, failures: 0 };
  let result: Lyrics | null = null;
  for (const g of guesses) {
    if (!g.title) continue;
    const params = new URLSearchParams({ track_name: g.title, artist_name: g.artist });
    if (duration > 0) params.set('duration', String(Math.round(duration)));
    const exact = (await getJson(`https://lrclib.net/api/get?${params}`, signal, stats, 6000)) as LrclibRecord | null;
    if (exact && (result = toLyrics(exact))) break;

    const search = (await getJson(
      `https://lrclib.net/api/search?${new URLSearchParams({ track_name: g.title, artist_name: g.artist })}`,
      signal,
      stats,
      8000
    )) as LrclibRecord[] | null;
    if (Array.isArray(search) && search.length) {
      // Prefiere resultados con letra sincronizada y duración parecida.
      const ranked = [...search].sort((a, b) => {
        const sa = (a.syncedLyrics ? 0 : 1000) + Math.abs((a.duration ?? 0) - duration);
        const sb = (b.syncedLyrics ? 0 : 1000) + Math.abs((b.duration ?? 0) - duration);
        return sa - sb;
      });
      for (const rec of ranked) {
        result = toLyrics(rec);
        if (result) break;
      }
      if (result) break;
    }
  }

  // Si todas las peticiones fallaron (sin internet o servicio caído) se avisa, y no se guarda como "sin letra".
  if (!result && !signal?.aborted && stats.requests > 0 && stats.failures === stats.requests) {
    throw new Error('network');
  }

  // Solo se guarda si no se canceló: un resultado vacío por cancelación no debe quedar en caché.
  if (!signal?.aborted) {
    memory.set(cacheKey, result);
    if (result) AsyncStorage.setItem(CACHE_PREFIX + cacheKey, JSON.stringify(result)).catch(() => {});
  }
  return result;
}
