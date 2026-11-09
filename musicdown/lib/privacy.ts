import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

// Preferencia "Ocultar mis descargas a otras apps". Activada por defecto.
// Cuando está activa, las descargas nuevas se guardan en el almacenamiento privado de la app con una
// extensión disfrazada (.zc3) y no se publican en la biblioteca multimedia del teléfono.

const KEY = 'musicdown.hideDownloads';

let hideDownloads = true;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function getHideDownloads(): boolean {
  return hideDownloads;
}

export async function loadPrivacySettings(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(KEY);
    if (stored !== null) {
      hideDownloads = stored === '1';
      emit();
    }
  } catch {
    // Sin preferencia guardada se mantiene el valor por defecto (activada).
  }
}

export async function setHideDownloads(value: boolean): Promise<void> {
  hideDownloads = value;
  emit();
  try {
    await AsyncStorage.setItem(KEY, value ? '1' : '0');
  } catch {
    // La preferencia aplica en esta sesión aunque no se pueda guardar.
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useHideDownloads(): boolean {
  return useSyncExternalStore(subscribe, () => hideDownloads);
}
