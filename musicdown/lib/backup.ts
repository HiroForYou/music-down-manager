import { Alert } from 'react-native';

import { getPlaylistsState, replaceAllPlaylists, subscribePlaylists, type Playlist } from './playlists';
import { getServerStatus } from './serverStatus';
import { getServerSettings } from './settings';

// Respaldo de playlists y "Me Gustan" en el servidor.
// - Cada cambio se copia al servidor (con 3 s de espera para agrupar cambios) cuando está conectado.
// - Si la app es nueva (nunca guardó listas aquí) y el servidor tiene un respaldo, se restaura.
// Hasta que se intenta la restauración no se envía nada, para no pisar el respaldo con una lista vacía.

let ready = false; // la restauración ya se intentó
let dirty = false;
let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;

async function endpoint(): Promise<{ url: string; headers: Record<string, string> } | null> {
  const { serverUrl, apiKey } = await getServerSettings();
  const base = serverUrl.trim().replace(/\/+$/, '');
  if (!base) return null;
  return { url: `${base}/api/library-backup`, headers: apiKey ? { 'x-api-key': apiKey } : {} };
}

async function flush(): Promise<void> {
  if (!dirty || !ready || getServerStatus() !== 'online') return;
  const state = getPlaylistsState();
  if (!state.loaded || !state.initialized) return;
  const target = await endpoint();
  if (!target) return;
  try {
    const response = await fetch(target.url, {
      method: 'PUT',
      headers: { ...target.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 1, playlists: state.playlists }),
    });
    if (response.ok) dirty = false;
  } catch {
    // Se reintenta con el próximo cambio o al volver a conectar.
  }
}

function schedule() {
  dirty = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, 3000);
}

/** Empieza a copiar al servidor cada cambio de las listas. */
export function startAutoBackup(): void {
  if (started) return;
  started = true;
  subscribePlaylists(schedule);
}

async function tryRestore(): Promise<void> {
  const state = getPlaylistsState();
  if (!state.loaded) return; // se reintenta en la siguiente conexión
  if (!state.initialized) {
    const target = await endpoint();
    if (target) {
      try {
        const response = await fetch(target.url, { headers: target.headers });
        if (response.ok) {
          const backup = (await response.json()) as { playlists?: Playlist[] };
          const playlists = Array.isArray(backup.playlists) ? backup.playlists : [];
          if (playlists.some((p) => p.entries.length > 0)) {
            replaceAllPlaylists(playlists);
            dirty = false;
            const count = playlists.reduce((n, p) => n + p.entries.length, 0);
            Alert.alert('Listas restauradas', `Se recuperaron ${playlists.length} lista(s) con ${count} canciones desde el servidor.`);
          }
        } else if (response.status !== 404) {
          return; // error del servidor: se reintenta luego
        }
      } catch {
        return;
      }
    }
  }
  ready = true;
}

/** Llamar cuando el ping confirma que el servidor está disponible. */
export async function onServerOnline(): Promise<void> {
  if (!ready) await tryRestore();
  await flush();
}
