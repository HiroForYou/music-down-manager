import { File, Paths } from 'expo-file-system';

import type { ExternalAudioItem } from './download';

// Resultado del último escaneo de la carpeta Música, guardado en disco. Así, al reiniciar el teléfono o la
// app, "Todas" muestra las canciones al instante y solo se refresca en segundo plano (sin pedir "Escanear").

function cacheFile(): File {
  return new File(Paths.document, 'external-scan.json');
}

export async function loadExternalCache(): Promise<ExternalAudioItem[] | null> {
  try {
    const file = cacheFile();
    if (!file.exists) return null;
    const data = JSON.parse(await file.text()) as { items?: ExternalAudioItem[] };
    return Array.isArray(data.items) ? data.items : null;
  } catch {
    return null;
  }
}

export function saveExternalCache(items: ExternalAudioItem[]): void {
  try {
    const file = cacheFile();
    if (!file.exists) file.create();
    file.write(JSON.stringify({ savedAt: Date.now(), items }));
  } catch {
    // Sin caché: habrá que volver a escanear la próxima vez.
  }
}
