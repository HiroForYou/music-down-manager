import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

// Preferencias de la pestaña Spotify.
// - openOnLongPress: si está activa, mantener pulsada una canción la abre en la app de Spotify.
//   Por defecto está desactivada: mantener pulsado inicia la selección múltiple.
// - streamFromServer: si está activa, los likes sin descargar suenan en streaming desde el servidor (solo si el
//   servidor está conectado). Por defecto está desactivada: suenan con el YouTube invisible (WebView).

const KEY = 'musicdown.spotifyPrefs.v1';

export type SpotifySort = 'recent' | 'oldest' | 'title' | 'artist' | 'album';

interface SpotifyPrefs {
  openOnLongPress: boolean;
  streamFromServer: boolean;
  /** Orden de la lista de likes. */
  sortMode: SpotifySort;
}

let prefs: SpotifyPrefs = { openOnLongPress: false, streamFromServer: false, sortMode: 'recent' };
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export async function loadSpotifyPrefs(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      prefs = { ...prefs, ...(JSON.parse(raw) as Partial<SpotifyPrefs>) };
      emit();
    }
  } catch {
    // Se mantienen los valores por defecto.
  }
}

export function getSpotifyPrefs(): SpotifyPrefs {
  return prefs;
}

export function setOpenOnLongPress(value: boolean): void {
  prefs = { ...prefs, openOnLongPress: value };
  emit();
  AsyncStorage.setItem(KEY, JSON.stringify(prefs)).catch(() => {});
}

export function setSpotifySort(value: SpotifySort): void {
  prefs = { ...prefs, sortMode: value };
  emit();
  AsyncStorage.setItem(KEY, JSON.stringify(prefs)).catch(() => {});
}

export function setStreamFromServer(value: boolean): void {
  prefs = { ...prefs, streamFromServer: value };
  emit();
  AsyncStorage.setItem(KEY, JSON.stringify(prefs)).catch(() => {});
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSpotifyPrefs(): SpotifyPrefs {
  return useSyncExternalStore(subscribe, () => prefs);
}
