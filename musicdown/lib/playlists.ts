import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import type { SpotifyLikedTrack } from './spotify';
import type { Track } from './types';

// Playlists locales (incluida la automática "Me Gustan") con respaldo en el servidor (ver backup.ts).
// Una entrada identifica una canción sin depender de que exista el archivo: así la lista sobrevive a una
// reinstalación (lo no descargado se puede volver a reproducir en streaming o bajar de nuevo).

export const LIKED_ID = 'liked';
const STORAGE_KEY = 'musicdown.playlists.v1';

export interface PlaylistEntry {
  /** Clave única: "sp:<idSpotify>", "app:<idDescarga>" o "ext:<idArchivoExterno>". */
  key: string;
  title: string;
  artist: string;
  image: string | null;
  trackId?: string;
  spotifyId?: string;
  assetId?: string;
  fileUri?: string;
  addedAt: number;
}

export interface Playlist {
  id: string;
  name: string;
  entries: PlaylistEntry[];
  createdAt: number;
  updatedAt: number;
}

interface PlaylistsState {
  loaded: boolean;
  /** Ya se guardó algo en este teléfono (si no, se puede restaurar el respaldo del servidor). */
  initialized: boolean;
  playlists: Playlist[];
  likedKeys: ReadonlySet<string>;
}

function emptyLiked(): Playlist {
  const now = Date.now();
  return { id: LIKED_ID, name: 'Me Gustan', entries: [], createdAt: now, updatedAt: now };
}

function derive(playlists: Playlist[]): Pick<PlaylistsState, 'playlists' | 'likedKeys'> {
  const liked = playlists.find((p) => p.id === LIKED_ID);
  return { playlists, likedKeys: new Set((liked?.entries ?? []).map((e) => e.key)) };
}

let state: PlaylistsState = { loaded: false, initialized: false, ...derive([emptyLiked()]) };
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function commit(playlists: Playlist[], persist = true) {
  state = { ...state, ...derive(playlists), initialized: state.initialized || persist };
  emit();
  if (persist) {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, playlists })).catch(() => {});
  }
}

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function update(id: string, fn: (p: Playlist) => Playlist) {
  commit(state.playlists.map((p) => (p.id === id ? { ...fn(p), updatedAt: Date.now() } : p)));
}

export async function loadPlaylists(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = (JSON.parse(raw) as { playlists?: Playlist[] }).playlists ?? [];
      const playlists = saved.some((p) => p.id === LIKED_ID) ? saved : [emptyLiked(), ...saved];
      state = { loaded: true, initialized: true, ...derive(playlists) };
      emit();
      return;
    }
  } catch {
    // Sin datos guardados o ilegibles: se parte de cero.
  }
  state = { ...state, loaded: true };
  emit();
}

export function getPlaylistsState(): PlaylistsState {
  return state;
}

export function getPlaylist(id: string): Playlist | undefined {
  return state.playlists.find((p) => p.id === id);
}

export function createPlaylist(name: string): string {
  const now = Date.now();
  const id = newId();
  commit([...state.playlists, { id, name: name.trim() || 'Nueva lista', entries: [], createdAt: now, updatedAt: now }]);
  return id;
}

export function renamePlaylist(id: string, name: string): void {
  if (id === LIKED_ID || !name.trim()) return;
  update(id, (p) => ({ ...p, name: name.trim() }));
}

export function deletePlaylist(id: string): void {
  if (id === LIKED_ID) return;
  commit(state.playlists.filter((p) => p.id !== id));
}

/** Agrega entradas (sin duplicar). Devuelve cuántas eran nuevas. */
export function addEntries(id: string, entries: PlaylistEntry[]): number {
  const playlist = getPlaylist(id);
  if (!playlist) return 0;
  const have = new Set(playlist.entries.map((e) => e.key));
  const fresh = entries.filter((e, i) => !have.has(e.key) && entries.findIndex((x) => x.key === e.key) === i);
  if (fresh.length === 0) return 0;
  update(id, (p) => ({ ...p, entries: [...p.entries, ...fresh] }));
  return fresh.length;
}

export function removeEntry(id: string, key: string): void {
  update(id, (p) => ({ ...p, entries: p.entries.filter((e) => e.key !== key) }));
}

export function moveEntry(id: string, from: number, to: number): void {
  update(id, (p) => {
    if (from === to || from < 0 || from >= p.entries.length) return p;
    const entries = [...p.entries];
    const [item] = entries.splice(from, 1);
    entries.splice(Math.max(0, Math.min(entries.length, to)), 0, item);
    return { ...p, entries };
  });
}

/** Corazón: agrega o quita la canción de "Me Gustan". Devuelve true si quedó marcada. */
export function toggleLike(entry: PlaylistEntry): boolean {
  if (state.likedKeys.has(entry.key)) {
    removeEntry(LIKED_ID, entry.key);
    return false;
  }
  addEntries(LIKED_ID, [entry]);
  return true;
}

/** Quita una canción de todas las listas (al eliminarla). */
export function removeKeysEverywhere(keys: string[]): void {
  const set = new Set(keys);
  if (!state.playlists.some((p) => p.entries.some((e) => set.has(e.key)))) return;
  commit(
    state.playlists.map((p) =>
      p.entries.some((e) => set.has(e.key)) ? { ...p, entries: p.entries.filter((e) => !set.has(e.key)), updatedAt: Date.now() } : p
    )
  );
}

/** Reemplaza todo (restauración del respaldo). */
export function replaceAllPlaylists(playlists: Playlist[]): void {
  const withLiked = playlists.some((p) => p.id === LIKED_ID) ? playlists : [emptyLiked(), ...playlists];
  commit(withLiked);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function subscribePlaylists(listener: () => void): () => void {
  return subscribe(listener);
}

export function usePlaylists(): PlaylistsState {
  return useSyncExternalStore(subscribe, () => state);
}

// ---- Constructores de entradas ----

export function entryFromSpotify(t: SpotifyLikedTrack): PlaylistEntry {
  return { key: `sp:${t.id}`, title: t.name, artist: t.artists, image: t.image, spotifyId: t.id, addedAt: Date.now() };
}

export function entryFromTrack(t: Track): PlaylistEntry {
  return {
    key: t.spotifyId ? `sp:${t.spotifyId}` : `app:${t.id}`,
    title: t.title,
    artist: t.artist,
    image: t.coverUri,
    trackId: t.id,
    spotifyId: t.spotifyId,
    addedAt: Date.now(),
  };
}

export function entryFromExternal(row: { id: string; title: string; artist: string; coverUri: string | null; fileUri: string }): PlaylistEntry {
  return {
    key: `ext:${row.id}`,
    title: row.title,
    artist: row.artist,
    image: row.coverUri,
    assetId: row.id,
    fileUri: row.fileUri,
    addedAt: Date.now(),
  };
}

/** Entrada a partir de un elemento de la cola del reproductor. */
export function entryFromPlayerItem(item: {
  id: string;
  title: string;
  artist: string;
  image: string | null;
  kind: 'local' | 'spotify';
  fileUri?: string;
  spotifyId?: string;
}): PlaylistEntry {
  const base = { title: item.title, artist: item.artist, image: item.image, addedAt: Date.now() };
  if (item.id.startsWith('app:')) {
    const trackId = item.id.slice(4);
    return { ...base, key: item.spotifyId ? `sp:${item.spotifyId}` : `app:${trackId}`, trackId, spotifyId: item.spotifyId };
  }
  if (item.id.startsWith('ext:')) {
    return { ...base, key: item.id, assetId: item.id.slice(4), fileUri: item.fileUri };
  }
  return { ...base, key: `sp:${item.id}`, spotifyId: item.id };
}
