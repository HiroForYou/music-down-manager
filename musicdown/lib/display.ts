import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

// Preferencia "ocultar barras del sistema" (notificaciones + navegación). Por defecto, ocultas.

const KEY = 'musicdown.hideSystemBars';

let hideSystemBars = true;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export async function loadDisplaySettings(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(KEY);
    if (stored !== null) {
      hideSystemBars = stored === '1';
      emit();
    }
  } catch {
    // Sin preferencia guardada se mantiene el valor por defecto.
  }
}

export async function setHideSystemBars(value: boolean): Promise<void> {
  hideSystemBars = value;
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

export function useHideSystemBars(): boolean {
  return useSyncExternalStore(subscribe, () => hideSystemBars);
}
