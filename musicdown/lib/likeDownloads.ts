import { useSyncExternalStore } from 'react';

import { downloadSpotifyLike } from './download';
import { setKeepAlive } from './keepAlive';
import { listTracks } from './library';
import type { SpotifyLikedTrack } from './spotify';
import type { Track } from './types';

// Descarga de likes de Spotify a la biblioteca local (para escucharlos sin internet ni servidor).
// Lleva la cuenta de cuáles ya están descargadas (por el id del like guardado en cada pista).

interface LikeDownloadsState {
  /** spotifyId -> pista descargada. */
  byId: ReadonlyMap<string, Track>;
  /** Id del like que se está descargando ahora. */
  current: string | null;
  /** % de la descarga actual (null = sin dato). */
  progress: number | null;
  /** Descarga por lotes en curso. */
  batch: { total: number; done: number; failed: number } | null;
  lastError: string | null;
}

let state: LikeDownloadsState = { byId: new Map(), current: null, progress: null, batch: null, lastError: null };
const listeners = new Set<() => void>();
let cancelRequested = false;

function set(patch: Partial<LikeDownloadsState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

/** Relee la biblioteca para saber qué likes ya están descargados. */
export async function refreshDownloadedLikes(): Promise<void> {
  const tracks = await listTracks();
  const byId = new Map<string, Track>();
  for (const t of tracks) if (t.spotifyId) byId.set(t.spotifyId, t);
  set({ byId });
}

async function downloadOneInternal(like: SpotifyLikedTrack): Promise<boolean> {
  set({ current: like.id, progress: null, lastError: null });
  try {
    const track = await downloadSpotifyLike(like, (percent) => set({ progress: percent }));
    const byId = new Map(state.byId);
    byId.set(like.id, track);
    set({ byId });
    return true;
  } catch (e) {
    set({ lastError: e instanceof Error ? e.message : 'No se pudo descargar la canción.' });
    return false;
  } finally {
    set({ current: null, progress: null });
  }
}

export function isBusy(): boolean {
  return state.current !== null || state.batch !== null;
}

/** Descarga una sola canción. */
export async function downloadLike(like: SpotifyLikedTrack): Promise<boolean> {
  if (isBusy() || state.byId.has(like.id)) return false;
  return downloadOneInternal(like);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Descarga todas las que faltan, una tras otra.
 * - Pausa breve entre canciones (más larga tras un fallo) para no saturar a YouTube con miles de peticiones.
 * - Se detiene tras 5 fallos seguidos (servidor apagado, sin red o YouTube limitando).
 * - Mientras dura, mantiene la app viva con la pantalla apagada (notificación "Descargando…").
 * - Es reanudable: lo ya descargado se reconoce por el id de Spotify, así que volver a pulsar continúa.
 */
export async function downloadPending(likes: SpotifyLikedTrack[]): Promise<void> {
  if (isBusy()) return;
  const pending = likes.filter((l) => !state.byId.has(l.id));
  if (pending.length === 0) return;
  cancelRequested = false;
  set({ batch: { total: pending.length, done: 0, failed: 0 }, lastError: null });
  let consecutiveFailures = 0;
  try {
    for (const like of pending) {
      if (cancelRequested) break;
      const b = state.batch ?? { total: pending.length, done: 0, failed: 0 };
      setKeepAlive({
        active: true,
        title: 'Descargando canciones de Spotify',
        detail: `${b.done + b.failed + 1} de ${b.total} · ${like.name}`,
      });
      const ok = await downloadOneInternal(like);
      const batch = state.batch ?? { total: pending.length, done: 0, failed: 0 };
      set({ batch: { ...batch, done: batch.done + (ok ? 1 : 0), failed: batch.failed + (ok ? 0 : 1) } });
      consecutiveFailures = ok ? 0 : consecutiveFailures + 1;
      if (consecutiveFailures >= 5) break;
      await sleep(ok ? 1200 : 6000);
    }
  } finally {
    setKeepAlive({ active: false, title: '', detail: '' });
    set({ batch: null });
  }
}

export function cancelBatch(): void {
  cancelRequested = true;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLikeDownloads(): LikeDownloadsState {
  return useSyncExternalStore(subscribe, () => state);
}
