import { AppState } from 'react-native';
import { useSyncExternalStore } from 'react';

// ¿La app está en primer plano (pantalla encendida y visible)? Con la pantalla apagada o la app en segundo
// plano no hace falta dibujar la interfaz: así no se acumula trabajo mientras suena la música.

let active = AppState.currentState === 'active';
const listeners = new Set<() => void>();

AppState.addEventListener('change', (next) => {
  const value = next === 'active';
  if (value === active) return;
  active = value;
  listeners.forEach((l) => l());
});

export function isAppActive(): boolean {
  return active;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAppActive(): boolean {
  return useSyncExternalStore(subscribe, () => active);
}
