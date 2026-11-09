import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

// Batería: ahorro de energía (activado por defecto) y modo sin conexión (desactivado por defecto).
// Modo sin conexión: la app no usa internet ni el servidor (sin ping, sincronización, descargas, letras nuevas,
// búsqueda de portadas ni YouTube); solo reproduce lo que ya está en el teléfono.
//
// Ahorro de energía: Con él activo la app hace menos trabajo mientras suena la música:
// la barra de progreso se actualiza cada 2 s (en vez de cada 1 s) y las animaciones (ecualizador, puntos de
// carga) quedan quietas. Con la pantalla apagada la interfaz no se actualiza en ningún caso.

const KEY = 'musicdown.powerPrefs.v1';

interface PowerPrefs {
  saveEnergy: boolean;
  offlineMode: boolean;
}

let prefs: PowerPrefs = { saveEnergy: true, offlineMode: false };
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

let loading: Promise<void> | null = null;

/** Espera a que las preferencias se hayan leído del almacenamiento (para no usar la red por error al arrancar). */
export function whenPowerPrefsLoaded(): Promise<void> {
  return loading ?? Promise.resolve();
}

export function loadPowerPrefs(): Promise<void> {
  loading = readPowerPrefs();
  return loading;
}

async function readPowerPrefs(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      prefs = { ...prefs, ...(JSON.parse(raw) as Partial<PowerPrefs>) };
      emit();
    }
  } catch {
    // Se mantiene el valor por defecto (activado).
  }
}

export function getPowerPrefs(): PowerPrefs {
  return prefs;
}

export function setSaveEnergy(value: boolean): void {
  prefs = { ...prefs, saveEnergy: value };
  emit();
  AsyncStorage.setItem(KEY, JSON.stringify(prefs)).catch(() => {});
}

export function setOfflineMode(value: boolean): void {
  prefs = { ...prefs, offlineMode: value };
  emit();
  AsyncStorage.setItem(KEY, JSON.stringify(prefs)).catch(() => {});
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePowerPrefs(): PowerPrefs {
  return useSyncExternalStore(subscribe, () => prefs);
}
