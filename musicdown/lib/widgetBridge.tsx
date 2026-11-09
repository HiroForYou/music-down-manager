import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';
import { Platform, TurboModuleRegistry } from 'react-native';

import type { NowPlayingProps } from '../widget/NowPlayingWidget';
import { getPowerPrefs } from './powerPrefs';

// Puente entre el reproductor y los widgets de la pantalla de inicio.
// - El reproductor publica aquí la canción actual y registra sus controles.
// - Los widgets (que corren en una tarea en segundo plano) leen ese estado y llaman a los controles.
// El código de los widgets solo se carga si el módulo nativo existe (build nuevo del dev client).

export interface PlayerController {
  togglePlay: () => void;
  next: () => void;
  previous: () => void;
}

/** Lo que publica el reproductor: la carátula llega tal cual (URL https o file://). */
export interface PublishedState extends Omit<NowPlayingProps, 'image'> {
  image: string | null;
}

const STORAGE_KEY = 'musicdown.widgetState.v2';
const controllerRef: { current: PlayerController | null } = { current: null };
let lastState: NowPlayingProps = { hasTrack: false, title: '', artist: '', playing: false, image: null };

export function getPlayerControllerRef() {
  return controllerRef;
}

export function getLastWidgetState(): NowPlayingProps {
  return lastState;
}

/** Recupera el último estado guardado (arranque en frío de la tarea del widget). */
export async function restoreWidgetState(): Promise<NowPlayingProps> {
  if (!lastState.hasTrack) {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) lastState = { ...(JSON.parse(stored) as NowPlayingProps), playing: false };
    } catch {
      // Sin estado previo: el widget muestra "Nada sonando".
    }
  }
  return lastState;
}

export function isWidgetSupported(): boolean {
  if (Platform.OS !== 'android') return false;
  try {
    return !!TurboModuleRegistry.get('AndroidWidget');
  } catch {
    return false;
  }
}

// ---- Carátula -> data URI (el widget no puede leer file:// ni siempre descargar URLs por su cuenta) ----

const imageCache = new Map<string, string | null>();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  }
  return btoa(binary);
}

async function resolveWidgetImage(raw: string | null): Promise<string | null> {
  if (!raw) return null;
  if (imageCache.has(raw)) return imageCache.get(raw) ?? null;
  let result: string | null = null;
  try {
    let bytes: Uint8Array;
    if (raw.startsWith('file:') || raw.startsWith('/')) {
      bytes = await new File(raw).bytes();
    } else {
      // Spotify: variante de 300 px (suficiente para el widget y ligera).
      const url = raw.replace('ab67616d0000b273', 'ab67616d00001e02').replace('ab67616d00004851', 'ab67616d00001e02');
      if (getPowerPrefs().offlineMode) throw new Error('offline'); // sin red: el widget muestra el cuadro de color
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      bytes = new Uint8Array(await response.arrayBuffer());
    }
    // Límite prudente: los widgets envían la imagen por Binder (tope ~1 MB).
    if (bytes.length > 0 && bytes.length < 400_000) result = `data:image/jpeg;base64,${bytesToBase64(bytes)}`;
  } catch {
    result = null;
  }
  if (imageCache.size > 30) imageCache.clear();
  imageCache.set(raw, result);
  return result;
}

export async function refreshWidgets(): Promise<void> {
  if (!isWidgetSupported()) return;
  try {
    const { requestWidgetUpdate } = require('react-native-android-widget') as typeof import('react-native-android-widget');
    const { WIDGET_NAMES, renderWidgetByName } = require('../widget/NowPlayingWidget') as typeof import('../widget/NowPlayingWidget');
    await Promise.all(
      WIDGET_NAMES.map((name) =>
        requestWidgetUpdate({
          widgetName: name,
          renderWidget: (info) => renderWidgetByName(name, lastState, { width: info.width, height: info.height }),
        })
      )
    );
  } catch {
    // Los widgets son opcionales: un fallo aquí no debe afectar la reproducción.
  }
}

export async function pushWidgetState(state: PublishedState): Promise<void> {
  // Primero se publica sin carátula nueva (respuesta inmediata) y luego se completa con la imagen.
  const previousImage = lastState.image;
  lastState = { ...state, image: previousImage };
  refreshWidgets();
  const image = await resolveWidgetImage(state.image);
  lastState = { ...state, image };
  // Solo se guarda cuando hay canción: así el arranque sin música no borra el último estado.
  if (state.hasTrack) AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(lastState)).catch(() => {});
  refreshWidgets();
}
