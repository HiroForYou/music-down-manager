import { useFocusEffect } from 'expo-router';
import { memo, useCallback, useDeferredValue, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Linking, Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ServerBanner } from '../../components/ServerBanner';
import { askConfirm } from '../../lib/confirm';
import { usePowerPrefs } from '../../lib/powerPrefs';
import { openAddToPlaylist } from '../../lib/playlistSheet';
import { entryFromSpotify, removeKeysEverywhere } from '../../lib/playlists';
import { useServerStatus } from '../../lib/serverStatus';
import { DownloadBadge, Icon, ScreenTitle, SearchField, TrackRow, type ActiveState } from '../../components/ui';
import { usePlayerSelection, type PlayerItem } from '../../lib/backgroundPlayer';
import { cancelBatch, downloadLike, downloadPending, refreshDownloadedLikes, useLikeDownloads } from '../../lib/likeDownloads';
import { deleteTrack } from '../../lib/download';
import { fetchLikedTracks, getCachedLiked, removeLikedTracks, type SpotifyLikedTrack } from '../../lib/spotify';
import { getPowerPrefs } from '../../lib/powerPrefs';
import { getSpotifyPrefs, setSpotifySort, useSpotifyPrefs, type SpotifySort } from '../../lib/spotifyPrefs';
import { showToast } from '../../lib/toast';
import { emitItemRemoved } from '../../lib/trackEvents';
import { colors, fonts } from '../../lib/theme';

const ROW_HEIGHT = 69;

const SORT_LABELS: Record<SpotifySort, string> = {
  recent: 'Recientes',
  oldest: 'Más antiguos',
  title: 'Título A-Z',
  artist: 'Artista A-Z',
  album: 'Álbum A-Z',
};
const SORT_MODES: SpotifySort[] = ['recent', 'oldest', 'title', 'artist', 'album'];

function formatSyncTime(timestamp: number | null): string {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Minúsculas y sin tildes, para que "cancion" encuentre "Canción". */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Las portadas de Spotify tienen variantes por tamaño; en la lista basta la de 64 px. */
function thumbnail(url: string | null): string | null {
  return url ? url.replace('ab67616d00001e02', 'ab67616d00004851').replace('ab67616d0000b273', 'ab67616d00004851') : null;
}

interface RowProps {
  track: SpotifyLikedTrack;
  index: number;
  isCurrent: boolean;
  activeState?: ActiveState;
  downloaded: boolean;
  downloading: boolean;
  /** Sin conexión y sin descargar: no se puede reproducir. */
  dimmed: boolean;
  onPlay: (index: number) => void;
  onDownload: (track: SpotifyLikedTrack) => void;
  canDownload: boolean;
  selecting: boolean;
  selected: boolean;
  onToggle: (id: string) => void;
  onLongPressRow: (track: SpotifyLikedTrack) => void;
}

// memo: una fila solo se vuelve a renderizar si cambia su canción, su estado de descarga o si pasa a ser / deja de ser la actual.
const SpotifyRow = memo(function SpotifyRow({ track, index, isCurrent, activeState, downloaded, downloading, dimmed, onPlay, onDownload, canDownload, selecting, selected, onToggle, onLongPressRow }: RowProps) {
  return (
    <View style={{ opacity: dimmed ? 0.45 : 1 }}>
    <TrackRow
      index={index}
      title={track.name}
      subtitle={track.artists}
      coverUri={thumbnail(track.image)}
      seed={track.id}
      active={isCurrent}
      activeState={activeState}
      selecting={selecting}
      selected={selected}
      onPress={() => (selecting ? onToggle(track.id) : onPlay(index))}
      onLongPress={() => onLongPressRow(track)}
      trailing={
        selecting ? null : (
        <View style={{ marginLeft: 4, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable onPress={() => openAddToPlaylist([entryFromSpotify(track)])} hitSlop={10}>
            <Icon name="plus" size={20} color={colors.ink} />
          </Pressable>
          <DownloadBadge state={downloaded ? 'done' : downloading ? 'downloading' : 'pending'} onPress={() => onDownload(track)} disabled={!canDownload} />
        </View>
        )
      }
    />
    </View>
  );
});

export default function SpotifyScreen() {
  const insets = useSafeAreaInsets();
  const { currentId, currentState, playQueue } = usePlayerSelection();
  const downloads = useLikeDownloads();
  const serverOnline = useServerStatus() === 'online';
  const [tracks, setTracks] = useState<SpotifyLikedTrack[]>([]);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const syncingRef = useRef(false);
  const sortMode = useSpotifyPrefs().sortMode;
  const offlineMode = usePowerPrefs().offlineMode;
  const [sortOpen, setSortOpen] = useState(false);

  // Selección múltiple (mantener pulsado, o el botón "Seleccionar").
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const selectingRef = useRef(false);
  selectingRef.current = selecting;

  // Al abrir la pestaña se muestra la última lista guardada, sin pedir nada al servidor.
  useFocusEffect(
    useCallback(() => {
      refreshDownloadedLikes();
      getCachedLiked().then((cached) => {
        if (cached) {
          setTracks(cached.tracks);
          setSyncedAt(cached.syncedAt);
        }
      });
    }, [])
  );

  const refresh = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const snapshot = await fetchLikedTracks();
      setTracks(snapshot.tracks);
      setSyncedAt(snapshot.syncedAt);
      setError(null);
      refreshDownloadedLikes();
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'No se pudo actualizar.';
      // La lista en pantalla no se borra: sigue mostrándose la copia guardada en el celular.
      const cached = await getCachedLiked();
      if (cached) {
        setTracks(cached.tracks);
        setSyncedAt(cached.syncedAt);
        setError(`${reason} Mostrando la lista guardada en el celular.`);
      } else {
        setError(reason);
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, []);

  // Texto de búsqueda precalculado una vez por lista, no en cada tecla.
  const searchIndex = useMemo(() => tracks.map((t) => normalize(`${t.name} ${t.artists} ${t.album}`)), [tracks]);

  const visibleTracks = useMemo(() => {
    const terms = normalize(deferredQuery).split(/\s+/).filter(Boolean);
    const filtered = terms.length === 0 ? tracks : tracks.filter((_, i) => terms.every((term) => searchIndex[i].includes(term)));
    if (sortMode === 'recent') return filtered; // el servidor ya las envía de más reciente a más antigua
    const sorted = [...filtered];
    const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });
    if (sortMode === 'oldest') sorted.reverse();
    else if (sortMode === 'title') sorted.sort((a, b) => byText(a.name, b.name) || byText(a.artists, b.artists));
    else if (sortMode === 'artist') sorted.sort((a, b) => byText(a.artists, b.artists) || byText(a.name, b.name));
    else if (sortMode === 'album') sorted.sort((a, b) => byText(a.album, b.album) || byText(a.name, b.name));
    return sorted;
  }, [tracks, searchIndex, deferredQuery, sortMode]);

  // Cuántas faltan por descargar (sobre la lista completa, no solo la filtrada).
  const downloadedCount = useMemo(() => tracks.filter((t) => downloads.byId.has(t.id)).length, [tracks, downloads.byId]);
  const pendingCount = tracks.length - downloadedCount;

  // La cola de reproducción es la lista visible. Lo ya descargado suena desde el archivo local
  // (sin internet ni servidor); lo demás, en streaming.
  const visibleRef = useRef(visibleTracks);
  visibleRef.current = visibleTracks;
  const byIdRef = useRef(downloads.byId);
  byIdRef.current = downloads.byId;
  const handlePlay = useCallback(
    (index: number) => {
      // Modo sin conexión: la cola solo incluye lo descargado; lo demás no suena.
      if (getPowerPrefs().offlineMode) {
        const downloaded = visibleRef.current.filter((t) => byIdRef.current.has(t.id));
        const tapped = visibleRef.current[index];
        const start = downloaded.findIndex((t) => t.id === tapped?.id);
        if (start < 0) {
          showToast('Sin conexión: descarga esta canción para escucharla', 'wifi-off');
          return;
        }
        playQueue(
          downloaded.map((t): PlayerItem => {
            const local = byIdRef.current.get(t.id)!;
            return { id: `app:${local.id}`, title: local.title, artist: local.artist, image: local.coverUri ?? t.image, kind: 'local', fileUri: local.fileUri, spotifyId: t.id };
          }),
          start
        );
        return;
      }
      const queue = visibleRef.current.map((t): PlayerItem => {
        const local = byIdRef.current.get(t.id);
        return local
          ? { id: `app:${local.id}`, title: local.title, artist: local.artist, image: local.coverUri ?? t.image, kind: 'local', fileUri: local.fileUri, spotifyId: t.id }
          : { id: t.id, title: t.name, artist: t.artists, image: t.image, kind: 'spotify', spotifyId: t.id };
      });
      playQueue(queue, index);
    },
    [playQueue]
  );

  const handleDownload = useCallback((track: SpotifyLikedTrack) => {
    downloadLike(track);
  }, []);

  const toggleSelected = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const cancelSelection = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
  }, []);

  // Mantener pulsado: selección múltiple, o abrir la canción en Spotify si esa opción está activada en Ajustes.
  const onLongPressRow = useCallback(
    (track: SpotifyLikedTrack) => {
      if (selectingRef.current) {
        toggleSelected(track.id);
      } else if (getSpotifyPrefs().openOnLongPress) {
        Linking.openURL(track.url);
      } else {
        setSelecting(true);
        setSelected(new Set([track.id]));
      }
    },
    [toggleSelected]
  );

  const selectAllVisible = useCallback(() => {
    setSelected(new Set(visibleRef.current.map((t) => t.id)));
  }, []);

  const addSelectedToList = useCallback(() => {
    const entries = tracks.filter((t) => selected.has(t.id)).map(entryFromSpotify);
    openAddToPlaylist(entries);
    cancelSelection();
  }, [tracks, selected, cancelSelection]);

  // Descargar las seleccionadas que aún no están en el teléfono (en lote, una tras otra).
  const downloadSelected = useCallback(() => {
    const list = tracks.filter((t) => selected.has(t.id) && !byIdRef.current.has(t.id));
    if (list.length === 0) {
      showToast('Las canciones seleccionadas ya están descargadas', 'check');
      return;
    }
    const run = () => {
      cancelSelection();
      downloadPending(list);
    };
    if (list.length <= 20) {
      run();
      return;
    }
    const gb = (list.length * 7) / 1024;
    const hours = (list.length * 30) / 3600;
    askConfirm({
      title: `¿Descargar ${list.length} canciones?`,
      message: `Ocuparán unos ${gb.toFixed(1)} GB y tardarán aproximadamente ${hours.toFixed(1)} horas. Mantén el servidor encendido, el teléfono cargando y con Wi-Fi. Puedes cancelar y continuar después.`,
      confirmLabel: 'Descargar',
      destructive: false,
      onConfirm: run,
    });
  }, [tracks, selected, cancelSelection]);

  const deleteSelected = useCallback(() => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const localCount = ids.filter((id) => byIdRef.current.has(id)).length;
    // Mismo diálogo de confirmación que al eliminar una pista desde Reproduciendo.
    askConfirm({
      title: ids.length === 1 ? '¿Eliminar 1 canción?' : `¿Eliminar ${ids.length} canciones?`,
      message: `Se quitarán de tus likes (en este teléfono y en el servidor)${
        localCount > 0 ? ` y se borrarán ${localCount} descarga(s) del teléfono` : ''
      }. La extensión de Spicetify también las quitará de Spotify si la tienes activada. Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      destructive: true,
      onConfirm: async () => {
        setDeleting(true);
        try {
          const keys: string[] = [];
          for (const id of ids) {
            keys.push(`sp:${id}`);
            const local = byIdRef.current.get(id);
            if (local) {
              keys.push(`app:${local.id}`);
              try {
                await deleteTrack(local.id); // avisa al reproductor
              } catch {
                // Ya no estaba en disco: se sigue con el resto.
              }
            }
            emitItemRemoved(id); // por si sonaba en streaming
          }
          await removeLikedTracks(ids);
          removeKeysEverywhere(keys);
          const gone = new Set(ids);
          setTracks((prev) => prev.filter((t) => !gone.has(t.id)));
          await refreshDownloadedLikes();
          cancelSelection();
          showToast(`${ids.length} ${ids.length === 1 ? 'canción eliminada' : 'canciones eliminadas'}`, 'trash-2');
        } catch (e) {
          Alert.alert('No se pudo eliminar', e instanceof Error ? e.message : String(e));
        } finally {
          setDeleting(false);
        }
      },
    });
  }, [selected, cancelSelection]);

  const renderItem = useCallback(
    ({ item, index }: { item: SpotifyLikedTrack; index: number }) => {
      const local = downloads.byId.get(item.id);
      const isCurrent = item.id === currentId || (local !== undefined && currentId === `app:${local.id}`);
      return (
        <SpotifyRow
          track={item}
          index={index}
          isCurrent={isCurrent}
          activeState={isCurrent ? currentState : undefined}
          downloaded={local !== undefined}
          downloading={downloads.current === item.id}
          dimmed={offlineMode && local === undefined}
          onPlay={handlePlay}
          onDownload={handleDownload}
          canDownload={serverOnline}
          selecting={selecting}
          selected={selected.has(item.id)}
          onToggle={toggleSelected}
          onLongPressRow={onLongPressRow}
        />
      );
    },
    [currentId, currentState, downloads.byId, downloads.current, handlePlay, handleDownload, serverOnline, selecting, selected, toggleSelected, onLongPressRow, offlineMode]
  );

  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index }),
    []
  );

  const subtitle = syncedAt
    ? `Tus likes, sincronizados desde tu laptop · ${formatSyncTime(syncedAt)}`
    : 'Tus likes, sincronizados desde tu laptop';

  const batch = downloads.batch;
  const listExtra = useMemo(() => ({ downloads, selecting, selected }), [downloads, selecting, selected]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + 24 }}>
      <ScreenTitle
        subtitle={subtitle}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
            {tracks.length > 0 && !selecting ? (
              <Pressable onPress={() => setSelecting(true)} hitSlop={8}>
                <Text style={{ fontFamily: fonts.sansSemi, fontSize: 14, color: colors.ink }}>Seleccionar</Text>
              </Pressable>
            ) : null}
          <Pressable onPress={refresh} disabled={syncing || !serverOnline} hitSlop={8}>
            <Text
              style={{
                fontFamily: fonts.sansSemi,
                fontSize: 14,
                color: colors.ink,
                borderBottomWidth: 1,
                borderBottomColor: colors.ink,
                opacity: syncing || !serverOnline ? 0.4 : 1,
              }}
            >
              {syncing ? 'Actualizando…' : 'Actualizar'}
            </Text>
          </Pressable>
          </View>
        }
      >
        Spotify
      </ScreenTitle>
      <SearchField value={query} onChangeText={setQuery} placeholder="Canción, artista o álbum" />
      <ServerBanner />

      {selecting ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginHorizontal: 24,
            marginTop: 8,
            height: 48,
            borderBottomWidth: 1,
            borderBottomColor: colors.ink,
          }}
        >
          <Pressable onPress={cancelSelection} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="x" size={18} />
            <Text style={{ fontFamily: fonts.sansMedium, fontSize: 14, color: colors.ink }}>{selected.size} seleccionada(s)</Text>
          </Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 20 }}>
            <Pressable onPress={selectAllVisible} hitSlop={8}>
              <Icon name="check-square" size={19} />
            </Pressable>
            <Pressable
              onPress={downloadSelected}
              disabled={selected.size === 0 || !serverOnline}
              hitSlop={8}
              style={{ opacity: selected.size === 0 || !serverOnline ? 0.4 : 1 }}
              accessibilityLabel="Descargar seleccionadas"
            >
              <Icon name="download" size={19} />
            </Pressable>
            <Pressable onPress={addSelectedToList} disabled={selected.size === 0} hitSlop={8} style={{ opacity: selected.size === 0 ? 0.4 : 1 }}>
              <Icon name="folder-plus" size={19} />
            </Pressable>
            <Pressable onPress={deleteSelected} disabled={selected.size === 0 || deleting} hitSlop={8} style={{ opacity: selected.size === 0 ? 0.4 : 1 }}>
              <Icon name="trash-2" size={19} color={colors.accent} />
            </Pressable>
          </View>
        </View>
      ) : tracks.length > 0 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 24, marginTop: 12 }}>
          <Icon name={pendingCount === 0 ? 'check-circle' : 'download-cloud'} size={18} color={pendingCount === 0 ? colors.accent : colors.ink} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fonts.sansSemi, fontSize: 13, color: colors.ink }}>
              {batch
                ? `Descargando ${Math.min(batch.done + batch.failed + 1, batch.total)} de ${batch.total}${
                    downloads.progress !== null ? ` · ${Math.round(downloads.progress)}%` : ''
                  }`
                : pendingCount === 0
                  ? 'Todas descargadas · disponibles sin conexión'
                  : `Faltan ${pendingCount} por descargar`}
            </Text>
            <Text style={{ fontFamily: fonts.sans, fontSize: 12, color: colors.muted }}>
              {batch
                ? batch.failed > 0
                  ? `${batch.failed} con error`
                  : 'Puedes seguir usando la app'
                : `${downloadedCount} de ${tracks.length} guardadas en tu teléfono`}
            </Text>
          </View>
          {batch ? (
            <Pressable onPress={cancelBatch} hitSlop={8}>
              <Text style={{ fontFamily: fonts.sansSemi, fontSize: 13, color: colors.accent, borderBottomWidth: 1, borderBottomColor: colors.accent }}>
                Cancelar
              </Text>
            </Pressable>
          ) : pendingCount > 0 ? (
            <Pressable
              onPress={() => {
                if (pendingCount <= 20) {
                  downloadPending(tracks);
                  return;
                }
                // Con muchas canciones se avisa de lo que implica (espacio, tiempo y condiciones).
                const gb = (pendingCount * 7) / 1024;
                const hours = (pendingCount * 30) / 3600;
                askConfirm({
                  title: `¿Descargar ${pendingCount} canciones?`,
                  message: `Ocuparán unos ${gb.toFixed(1)} GB y tardarán aproximadamente ${hours.toFixed(1)} horas. Mantén el servidor encendido, el teléfono cargando y con Wi-Fi. Puedes cancelar y continuar después: lo ya descargado se conserva.`,
                  confirmLabel: 'Descargar',
                  destructive: false,
                  onConfirm: () => downloadPending(tracks),
                });
              }}
              disabled={downloads.current !== null || !serverOnline}
              hitSlop={8}
            >
              <Text style={{ fontFamily: fonts.sansSemi, fontSize: 13, color: colors.ink, borderBottomWidth: 1, borderBottomColor: colors.ink }}>
                {serverOnline ? 'Descargar todas' : 'Sin servidor'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {error ? (
        <Text style={{ marginHorizontal: 24, marginTop: 10, fontFamily: fonts.sans, fontSize: 13, color: colors.accent }}>{error}</Text>
      ) : null}
      {downloads.lastError ? (
        <Text style={{ marginHorizontal: 24, marginTop: 6, fontFamily: fonts.sans, fontSize: 12, color: colors.accent }}>
          {downloads.lastError}
        </Text>
      ) : null}
      {tracks.length > 0 && !selecting ? (
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 24, marginTop: 10 }}>
          <Pressable onPress={() => setSortOpen(true)} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="bar-chart" size={15} color={colors.muted} />
            <Text style={{ fontFamily: fonts.sansMedium, fontSize: 12, color: colors.muted }}>{SORT_LABELS[sortMode]}</Text>
          </Pressable>
        </View>
      ) : null}
      <FlatList
        style={{ flex: 1, marginTop: 8 }}
        data={visibleTracks}
        extraData={listExtra}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        getItemLayout={getItemLayout}
        initialNumToRender={15}
        maxToRenderPerBatch={15}
        windowSize={11}
        removeClippedSubviews
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          syncing ? null : (
            <Text style={{ paddingHorizontal: 24, paddingVertical: 24, fontFamily: fonts.serifItalic, fontSize: 15, color: colors.muted }}>
              {query
                ? 'Ninguna canción coincide con la búsqueda.'
                : syncedAt
                  ? 'No tienes canciones con like.'
                  : 'Pulsa "Actualizar" para traer tus canciones con like.'}
            </Text>
          )
        }
      />

      <Modal visible={sortOpen} animationType="fade" transparent onRequestClose={() => setSortOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(20,33,43,0.4)' }} onPress={() => setSortOpen(false)} />
        <View style={{ backgroundColor: colors.bg, paddingHorizontal: 24, paddingTop: 20, paddingBottom: insets.bottom + 20 }}>
          <Text style={{ fontFamily: fonts.sansMedium, fontSize: 11, letterSpacing: 1.4, color: colors.muted, marginBottom: 6 }}>ORDENAR POR</Text>
          {SORT_MODES.map((mode) => {
            const active = sortMode === mode;
            return (
              <Pressable
                key={mode}
                onPress={() => {
                  setSpotifySort(mode);
                  setSortOpen(false);
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingVertical: 16,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.line,
                }}
              >
                <Text style={{ fontFamily: fonts.serif, fontSize: 18, color: active ? colors.accent : colors.ink }}>{SORT_LABELS[mode]}</Text>
                {active ? <Icon name="check" size={18} color={colors.accent} /> : null}
              </Pressable>
            );
          })}
        </View>
      </Modal>
    </View>
  );
}
