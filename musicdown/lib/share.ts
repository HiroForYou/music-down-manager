import { requireOptionalNativeModule } from 'expo';
import { Directory, File, Paths } from 'expo-file-system';

import type { Track } from './types';

// Compartir una canción (WhatsApp, Bluetooth, etc.) siempre como archivo .mp3, aunque en el teléfono esté
// guardada con la extensión disfrazada (.zc3): se entrega una copia temporal "Título.mp3".

function shareDirectory(): Directory {
  const dir = new Directory(Paths.cache, 'musicdown-share');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 80) || 'cancion';
}

export function isSharingSupported(): boolean {
  return !!requireOptionalNativeModule('ExpoSharing');
}

/** Borra copias temporales de compartidos anteriores. */
export function cleanShareCache(): void {
  try {
    const dir = new Directory(Paths.cache, 'musicdown-share');
    if (dir.exists) dir.delete();
  } catch {
    // No es crítico.
  }
}

export async function shareTrack(track: Pick<Track, 'title' | 'artist' | 'fileUri'>): Promise<void> {
  if (!isSharingSupported()) {
    throw new Error('Compartir necesita la versión nueva de la app. Recompila el dev client.');
  }
  const Sharing = require('expo-sharing') as typeof import('expo-sharing');
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Este dispositivo no permite compartir archivos.');
  }
  const source = new File(track.fileUri);
  if (!source.exists) throw new Error('No se encontró el archivo de la canción.');

  const dir = shareDirectory();
  const target = new File(dir, `${safeName(`${track.artist} - ${track.title}`)}.mp3`);
  if (target.exists) target.delete();
  source.copy(target);

  await Sharing.shareAsync(target.uri, {
    mimeType: 'audio/mpeg',
    dialogTitle: `Compartir ${track.title}`,
    UTI: 'public.mp3',
  });
}
