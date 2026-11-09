import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

// Preferencias de la bienvenida:
// - showSplash: animación de bienvenida (logo + nombre) en cada arranque. Por defecto, activada.
// - showIntro: carrusel de introducción (3 pasos). Se muestra mientras esté activado y aún no se haya visto;
//   al terminarlo se marca como visto. "Ver introducción" lo vuelve a abrir cuando se quiera.

const KEY = 'musicdown.welcomePrefs.v1';

interface WelcomePrefs {
  loaded: boolean;
  showSplash: boolean;
  showIntro: boolean;
  introSeen: boolean;
  /** Se incrementa cuando el usuario pide ver la introducción ahora. */
  introRequest: number;
}

let prefs: WelcomePrefs = { loaded: false, showSplash: true, showIntro: true, introSeen: false, introRequest: 0 };
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function persist() {
  const { showSplash, showIntro, introSeen } = prefs;
  AsyncStorage.setItem(KEY, JSON.stringify({ showSplash, showIntro, introSeen })).catch(() => {});
}

export async function loadWelcomePrefs(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<WelcomePrefs>;
      prefs = {
        ...prefs,
        showSplash: saved.showSplash ?? true,
        showIntro: saved.showIntro ?? true,
        introSeen: saved.introSeen ?? false,
      };
    } else {
      // Instalaciones anteriores marcaban la introducción como vista con esta clave.
      const legacy = await AsyncStorage.getItem('musicdown.onboarded');
      if (legacy === '1') prefs = { ...prefs, introSeen: true };
    }
  } catch {
    // Valores por defecto.
  }
  prefs = { ...prefs, loaded: true };
  emit();
}

export function getWelcomePrefs(): WelcomePrefs {
  return prefs;
}

export function setShowSplash(value: boolean): void {
  prefs = { ...prefs, showSplash: value };
  persist();
  emit();
}

export function setShowIntro(value: boolean): void {
  // Al activarlo se vuelve a mostrar en el próximo inicio.
  prefs = { ...prefs, showIntro: value, introSeen: value ? false : prefs.introSeen };
  persist();
  emit();
}

export function markIntroSeen(): void {
  prefs = { ...prefs, introSeen: true };
  persist();
  emit();
}

/** Abre la introducción ahora mismo (botón "Ver introducción" de Ajustes). */
export function requestIntroNow(): void {
  prefs = { ...prefs, introRequest: prefs.introRequest + 1 };
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useWelcomePrefs(): WelcomePrefs {
  return useSyncExternalStore(subscribe, () => prefs);
}
