import { useSyncExternalStore } from 'react';

import { getPowerPrefs, whenPowerPrefsLoaded } from './powerPrefs';
import { getServerSettings } from './settings';

// Estado del servidor de conversión. Se comprueba (ping) al abrir la app, al volver a primer plano, al
// guardar los Ajustes y a petición. Según el resultado se habilitan o deshabilitan las opciones que lo usan
// (descargas, sincronizar likes); reproducir lo ya descargado nunca depende de él.

export type ServerStatus = 'unknown' | 'checking' | 'online' | 'offline' | 'unauthorized' | 'unconfigured' | 'disabled';

interface ServerState {
  status: ServerStatus;
  checkedAt: number;
}

let state: ServerState = { status: 'unknown', checkedAt: 0 };
const listeners = new Set<() => void>();
let inflight: Promise<ServerStatus> | null = null;

function set(status: ServerStatus) {
  state = { status, checkedAt: status === 'checking' ? state.checkedAt : Date.now() };
  listeners.forEach((l) => l());
}

async function timedFetch(url: string, headers: Record<string, string> | undefined, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Hace ping al servidor (salud + clave de acceso) y actualiza el estado. */
export function checkServer(): Promise<ServerStatus> {
  // Modo sin conexión: no se hace ping ni se usa la red.
  if (getPowerPrefs().offlineMode) {
    set('disabled');
    return Promise.resolve('disabled');
  }
  if (inflight) return inflight;
  inflight = (async () => {
    await whenPowerPrefsLoaded();
    if (getPowerPrefs().offlineMode) {
      set('disabled');
      return 'disabled' as const;
    }
    const { serverUrl, apiKey } = await getServerSettings();
    const base = serverUrl.trim().replace(/\/+$/, '');
    if (!base) {
      set('unconfigured');
      return 'unconfigured' as const;
    }
    set('checking');
    try {
      const health = await timedFetch(`${base}/api/health`, undefined, 4000);
      if (!health.ok) {
        set('offline');
        return 'offline' as const;
      }
      // /api/progress exige la clave: sirve para saber si la de Ajustes es la correcta.
      const auth = await timedFetch(`${base}/api/progress?jobId=ping`, apiKey ? { 'x-api-key': apiKey } : undefined, 4000);
      const result: ServerStatus = auth.status === 401 ? 'unauthorized' : 'online';
      set(result);
      return result;
    } catch {
      set('offline');
      return 'offline' as const;
    }
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

export function getServerStatus(): ServerStatus {
  return state.status;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useServerStatus(): ServerStatus {
  return useSyncExternalStore(subscribe, () => state.status);
}

export const SERVER_STATUS_TEXT: Record<ServerStatus, string> = {
  unknown: 'Servidor sin comprobar',
  checking: 'Comprobando servidor…',
  online: 'Servidor conectado',
  offline: 'Sin conexión con el servidor',
  unauthorized: 'Clave de acceso incorrecta',
  unconfigured: 'Servidor sin configurar',
  disabled: 'Modo sin conexión activado',
};
