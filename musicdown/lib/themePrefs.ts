import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

// Personalización de temas.
// - coverBackground: el fondo de la pantalla Reproduciendo toma un tono parecido al de la portada.
// - intensity: qué tan marcado es ese tono (suave, medio o fuerte). Siempre queda claro, para que el texto se lea.

const KEY = 'musicdown.themePrefs.v1';

export type TintIntensity = 'soft' | 'medium' | 'strong';

interface ThemePrefs {
  coverBackground: boolean;
  intensity: TintIntensity;
}

let prefs: ThemePrefs = { coverBackground: true, intensity: 'medium' };
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function save() {
  AsyncStorage.setItem(KEY, JSON.stringify(prefs)).catch(() => {});
}

export async function loadThemePrefs(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      prefs = { ...prefs, ...(JSON.parse(raw) as Partial<ThemePrefs>) };
      emit();
    }
  } catch {
    // Se mantienen los valores por defecto.
  }
}

export function setCoverBackground(value: boolean): void {
  prefs = { ...prefs, coverBackground: value };
  emit();
  save();
}

export function setTintIntensity(value: TintIntensity): void {
  prefs = { ...prefs, intensity: value };
  emit();
  save();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useThemePrefs(): ThemePrefs {
  return useSyncExternalStore(subscribe, () => prefs);
}
