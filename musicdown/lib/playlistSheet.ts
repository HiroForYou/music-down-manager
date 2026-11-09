import { useSyncExternalStore } from 'react';

import type { PlaylistEntry } from './playlists';

// Hoja "Agregar a lista": cualquier pantalla la abre con openAddToPlaylist(entradas) y la muestra
// el componente AddToPlaylistSheet montado una sola vez en el layout raíz.

let pending: PlaylistEntry[] | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function openAddToPlaylist(entries: PlaylistEntry[]): void {
  if (entries.length === 0) return;
  pending = entries;
  emit();
}

export function closeAddToPlaylist(): void {
  pending = null;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAddToPlaylistRequest(): PlaylistEntry[] | null {
  return useSyncExternalStore(subscribe, () => pending);
}
