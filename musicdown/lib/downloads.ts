import { useSyncExternalStore } from 'react';

import { downloadTrack } from './download';
import { showToast } from './toast';

// Registro de descargas de la sesión: lo comparten las pestañas "Enlace" y "YouTube".

export interface DownloadItem {
  id: string;
  title: string;
  progress: number | null;
  status: 'downloading' | 'done' | 'error';
  error?: string;
  coverUri?: string | null;
}

interface DownloadsState {
  items: DownloadItem[];
  busy: boolean;
  progress: number | null;
}

let state: DownloadsState = { items: [], busy: false, progress: null };
const listeners = new Set<() => void>();

function set(patch: Partial<DownloadsState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function patchItem(id: string, patch: Partial<DownloadItem>) {
  set({ items: state.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
}

// Avisos con el mismo toast del resto de la app.
function notify(message: string, error = false) {
  showToast(message, error ? 'alert-circle' : 'check');
}

function labelFor(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return url;
  }
}

/** Descarga un enlace y lo registra en la lista. Devuelve true si terminó bien. */
export async function startDownload(url: string): Promise<boolean> {
  if (state.busy) return false;
  const id = `${Date.now()}`;
  const entry: DownloadItem = { id, title: labelFor(url), progress: null, status: 'downloading' };
  set({
    busy: true,
    progress: null,
    items: [entry, ...state.items].slice(0, 20),
  });
  try {
    const track = await downloadTrack(url, (percent) => {
      set({ progress: percent });
      patchItem(id, { progress: percent });
    });
    patchItem(id, { title: track.title, progress: 100, status: 'done', coverUri: track.coverUri });
    notify('Guardado en Música');
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'No se pudo descargar el enlace.';
    patchItem(id, { status: 'error', error: message });
    notify(message, true);
    return false;
  } finally {
    set({ busy: false, progress: null });
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDownloads(): DownloadsState {
  return useSyncExternalStore(subscribe, () => state);
}
