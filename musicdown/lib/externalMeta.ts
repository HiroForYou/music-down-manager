import { Directory, File, Paths } from 'expo-file-system';

import { readId3 } from './id3Read';

// Metadatos de los MP3 externos (carpeta Música): se leen de sus etiquetas ID3. La portada se guarda en una
// carpeta de caché para poder mostrarla como imagen normal.

export interface ExternalMeta {
  title?: string;
  artist?: string;
  /** URI (file://) de la portada guardada en caché. */
  cover?: string;
}

function coversDirectory(): Directory {
  const dir = new Directory(Paths.cache, 'musicdown-covers');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Lee título, artista y portada de un MP3 externo. Devuelve {} si no tiene etiquetas. */
export async function readExternalMeta(assetId: string, fileUri: string): Promise<ExternalMeta> {
  const info = await readId3(fileUri);
  if (!info) return {};
  const meta: ExternalMeta = { title: info.title, artist: info.artist };
  if (info.cover) {
    try {
      const ext = info.cover.mime.includes('png') ? 'png' : 'jpg';
      const file = new File(coversDirectory(), `${assetId}.${ext}`);
      if (!file.exists) {
        file.create();
        file.write(info.cover.bytes);
      }
      meta.cover = file.uri;
    } catch {
      // Sin portada en caché: se muestra el cuadro de color.
    }
  }
  return meta;
}
