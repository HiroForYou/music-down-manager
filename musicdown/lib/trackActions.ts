import { Alert } from 'react-native';

import { askConfirm } from './confirm';

import type { PlayerItem } from './backgroundPlayer';
import { deleteExternalAssets, deleteTrack } from './download';
import { removeKeysEverywhere } from './playlists';
import { removeLikedTrack } from './spotify';
import { showToast } from './toast';
import { emitItemRemoved } from './trackEvents';

/**
 * Elimina la canción que suena (botón de papelera del reproductor), con confirmación:
 * - Descarga de la app: borra el archivo. Si venía de tus likes de Spotify, también la quita de esa lista
 *   (en el teléfono y en el servidor).
 * - Archivo externo (carpeta Música): lo borra; Android pide su propia confirmación.
 * - Like de Spotify sin descargar: lo quita de la lista de likes (teléfono y servidor).
 * En todos los casos sale de las playlists.
 */
export function confirmDeleteItem(item: PlayerItem): void {
  const isApp = item.id.startsWith('app:');
  const isExternal = item.id.startsWith('ext:');
  const spotifyId = item.spotifyId ?? (!isApp && !isExternal ? item.id : undefined);

  const message = isApp
    ? `Se eliminará "${item.title}" del teléfono${spotifyId ? ' y de tu lista de likes de Spotify (también en el servidor; la extensión de Spicetify la quitará de Spotify si está activada)' : ''}. Esta acción no se puede deshacer.`
    : isExternal
      ? `Se eliminará "${item.title}" de tu carpeta Música. Android te pedirá confirmación.`
      : `Se quitará "${item.title}" de tu lista de likes (en este teléfono y en el servidor). La extensión de Spicetify también la quitará de tu biblioteca de Spotify si la tienes activada.`;

  askConfirm({
    title: `¿Eliminar “${item.title}”?`,
    message,
    confirmLabel: 'Eliminar',
    destructive: true,
    onConfirm: async () => {
        try {
          const keys: string[] = [];
          if (isApp) {
            keys.push(item.id);
            await deleteTrack(item.id.slice(4)); // avisa al reproductor
          } else if (isExternal) {
            keys.push(item.id);
            await deleteExternalAssets([item.id.slice(4)]);
            emitItemRemoved(item.id);
          }
          if (spotifyId) {
            keys.push(`sp:${spotifyId}`);
            await removeLikedTrack(spotifyId);
            if (!isApp && !isExternal) emitItemRemoved(item.id);
          }
          removeKeysEverywhere(keys);
          showToast('Canción eliminada', 'trash-2');
        } catch (e) {
          Alert.alert('No se pudo eliminar', e instanceof Error ? e.message : String(e));
        }
    },
  });
}
