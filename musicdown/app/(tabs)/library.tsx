import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PlaylistsPane } from '../../components/PlaylistsPane';
import { Icon, ScreenTitle, SearchField, TextTabs, TrackRow } from '../../components/ui';
import { openAddToPlaylist } from '../../lib/playlistSheet';
import { entryFromExternal, entryFromTrack, usePlaylists } from '../../lib/playlists';
import { usePlayerSelection, useBackgroundPlayer, type PlayerItem } from '../../lib/backgroundPlayer';
import {
  deleteExternalAssets,
  deleteTrack,
  hasAudioPermission,
  importExternalTrack,
  listAllMusicFolderAudio,
  moveTracksToMusic,
  type ExternalAudioItem,
} from '../../lib/download';
import { loadExternalCache, saveExternalCache } from '../../lib/externalScan';
import { readExternalMeta, type ExternalMeta } from '../../lib/externalMeta';
import { listTracks } from '../../lib/library';
import { shareTrack } from '../../lib/share';
import { showToast } from '../../lib/toast';
import { colors, fonts } from '../../lib/theme';
import type { Track } from '../../lib/types';

const ROW_HEIGHT = 69; // altura fija de cada fila: la lista no tiene que medirlas

type FilterMode = 'downloaded' | 'all' | 'playlists';
type SortMode = 'recent' | 'title' | 'artist';

const SORT_LABELS: Record<SortMode, string> = {
  recent: 'Recientes',
  title: 'Título A-Z',
  artist: 'Artista A-Z',
};
const SORT_MODES: SortMode[] = ['recent', 'title', 'artist'];

interface LibraryRow {
  key: string;
  kind: 'app' | 'external';
  id: string;
  title: string;
  artist: string;
  fileUri: string;
  coverUri: string | null;
  spotifyId?: string;
}

/** Minúsculas y sin tildes, para que "cancion" encuentre "Canción". */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export default function LibraryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { currentId, currentState, playQueue } = usePlayerSelection();
  const { stop } = useBackgroundPlayer();

  const [filterMode, setFilterMode] = useState<FilterMode>('downloaded');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [externalItems, setExternalItems] = useState<ExternalAudioItem[]>([]);
  const [externalError, setExternalError] = useState<string | null>(null);
  const [hasScanned, setHasScanned] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [moving, setMoving] = useState(false);
  // Título, artista y portada leídos de las etiquetas de los MP3 externos (solo los que se van mostrando).
  const [meta, setMeta] = useState<Record<string, ExternalMeta>>({});
  const metaQueue = useRef<{ id: string; uri: string }[]>([]);
  const metaSeen = useRef(new Set<string>());
  const metaPending = useRef<Record<string, ExternalMeta>>({});
  const metaWorker = useRef(false);
  const metaFlush = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reloadAppTracks = useCallback(async () => {
    const appTracks = await listTracks();
    setTracks(appTracks);
    return appTracks;
  }, []);

  useFocusEffect(
    useCallback(() => {
      reloadAppTracks();
    }, [reloadAppTracks])
  );

  // Se guarda la lista completa de Música; lo que ya es de la app se descarta al mostrarla (así la caché sigue
  // siendo válida si se importa o se mueve algo).
  const scanMusicFolder = useCallback(
    async (silent = false) => {
      if (!silent) setScanning(true);
      setExternalError(null);
      try {
        await reloadAppTracks();
        const items = await listAllMusicFolderAudio(new Set());
        setExternalItems(items);
        setHasScanned(true);
        saveExternalCache(items);
      } catch (e) {
        if (!silent) setExternalError(e instanceof Error ? e.message : 'No se pudo leer la carpeta Music.');
      } finally {
        if (!silent) setScanning(false);
      }
    },
    [reloadAppTracks]
  );

  // Al abrir la app: lo último escaneado aparece al instante, sin pedir "Escanear" otra vez.
  useEffect(() => {
    let alive = true;
    loadExternalCache().then((items) => {
      if (alive && items) {
        setExternalItems(items);
        setHasScanned(true);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  // Al entrar a "Todas" se actualiza en segundo plano (solo si el permiso ya está concedido).
  const autoRefreshed = useRef(false);
  useEffect(() => {
    if (filterMode !== 'all' || autoRefreshed.current) return;
    autoRefreshed.current = true;
    hasAudioPermission().then((granted) => {
      if (granted) scanMusicFolder(true);
    });
  }, [filterMode, scanMusicFolder]);

  const knownAssetIds = useMemo(() => new Set(tracks.map((t) => t.mediaAssetId).filter((v): v is string => Boolean(v))), [tracks]);
  const visibleExternal = useMemo(() => externalItems.filter((item) => !knownAssetIds.has(item.mediaAssetId)), [externalItems, knownAssetIds]);

  const rows = useMemo(() => {
    const all: LibraryRow[] = [
      ...tracks.map(
        (t): LibraryRow => ({
          key: `app:${t.id}`,
          kind: 'app',
          id: t.id,
          title: t.title,
          artist: t.artist,
          fileUri: t.fileUri,
          coverUri: t.coverUri,
          spotifyId: t.spotifyId,
        })
      ),
      ...(filterMode === 'all'
        ? visibleExternal.map(
            (item): LibraryRow => ({
              key: `ext:${item.mediaAssetId}`,
              kind: 'external',
              id: item.mediaAssetId,
              title: item.title,
              artist: item.artist,
              fileUri: item.fileUri,
              coverUri: null,
            })
          )
        : []),
    ];
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    const filtered = terms.length
      ? all.filter((r) => {
          const haystack = normalize(`${r.title} ${r.artist}`);
          return terms.every((t) => haystack.includes(t));
        })
      : all;
    if (sortMode === 'title') filtered.sort((a, b) => a.title.localeCompare(b.title));
    else if (sortMode === 'artist') filtered.sort((a, b) => a.artist.localeCompare(b.artist));
    return filtered;
  }, [tracks, visibleExternal, filterMode, query, sortMode]);

  const runMetaWorker = useCallback(async () => {
    if (metaWorker.current) return;
    metaWorker.current = true;
    try {
      while (metaQueue.current.length > 0) {
        // Último en entrar, primero en salir: lo que acaba de aparecer en pantalla va antes.
        const job = metaQueue.current.pop();
        if (!job) break;
        try {
          metaPending.current[job.id] = await readExternalMeta(job.id, job.uri);
        } catch {
          metaPending.current[job.id] = {};
        }
        if (!metaFlush.current) {
          metaFlush.current = setTimeout(() => {
            metaFlush.current = null;
            const batch = metaPending.current;
            metaPending.current = {};
            setMeta((prev) => ({ ...prev, ...batch }));
          }, 350);
        }
        // Cede el hilo entre archivos para que el desplazamiento siga fluido.
        await new Promise((resolve) => setTimeout(resolve, 8));
      }
    } finally {
      metaWorker.current = false;
    }
  }, []);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: { index: number | null }[] }) => {
    const list = rowsRef.current;
    const indices = viewableItems.map((v) => v.index).filter((i): i is number => i !== null);
    if (indices.length === 0) return;
    // Los visibles y unos cuantos siguientes (para que ya estén listos al desplazar).
    const from = Math.min(...indices);
    const to = Math.min(list.length - 1, Math.max(...indices) + 12);
    for (let i = from; i <= to; i++) {
      const row = list[i];
      if (row.kind !== 'external' || metaSeen.current.has(row.id) || !/\.mp3$/i.test(row.fileUri)) continue;
      metaSeen.current.add(row.id);
      metaQueue.current.push({ id: row.id, uri: row.fileUri });
    }
    runMetaWorker();
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 10, minimumViewTime: 120 }).current;
  const listExtra = useMemo(() => ({ selected, meta }), [selected, meta]);

  // Referencias para que los manejadores de fila sean estables (las filas memoizadas no se redibujan).
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const metaRef = useRef(meta);
  metaRef.current = meta;

  const handlePlay = useCallback(
    (index: number) => {
      // Los externos usan lo leído de sus etiquetas (título, artista, portada) para el reproductor y el widget.
      const queue: PlayerItem[] = rowsRef.current.map((r) => {
        const m = r.kind === 'external' ? metaRef.current[r.id] : undefined;
        return {
          id: r.key,
          title: m?.title ?? r.title,
          artist: m?.artist ?? r.artist,
          image: m?.cover ?? r.coverUri,
          kind: 'local',
          fileUri: r.fileUri,
          spotifyId: r.spotifyId,
        };
      });
      playQueue(queue, index);
    },
    [playQueue]
  );

  const toggleSelected = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      if (next.size === 0) setSelectionMode(false);
      return next;
    });
  }, []);

  const startSelecting = useCallback((key: string) => {
    setSelectionMode(true);
    setSelected(new Set([key]));
  }, []);

  const cancelSelection = useCallback(() => {
    setSelectionMode(false);
    setSelected(new Set());
  }, []);

  const selectionModeRef = useRef(selectionMode);
  selectionModeRef.current = selectionMode;
  const onRowPress = useCallback(
    (key: string, index: number) => {
      if (selectionModeRef.current) toggleSelected(key);
      else handlePlay(index);
    },
    [toggleSelected, handlePlay]
  );
  const onRowLongPress = useCallback(
    (key: string) => {
      if (selectionModeRef.current) toggleSelected(key);
      else startSelecting(key);
    },
    [toggleSelected, startSelecting]
  );

  const singleEditable = useMemo(() => {
    if (selected.size !== 1) return null;
    const [key] = [...selected];
    return key.startsWith('app:') ? key.slice(4) : null;
  }, [selected]);

  // Canciones de la app seleccionadas que todavía no están en la carpeta Música.
  const movableIds = useMemo(
    () =>
      [...selected]
        .filter((k) => k.startsWith('app:'))
        .map((k) => k.slice(4))
        .filter((id) => tracks.find((t) => t.id === id)?.inMusic !== true),
    [selected, tracks]
  );

  const handleMoveToMusic = useCallback(() => {
    if (movableIds.length === 0) return;
    Alert.alert(
      'Mover a la carpeta Música',
      `Se guardarán ${movableIds.length} canción(es) como archivos .mp3 en la carpeta Música del teléfono. Seguirán en tu biblioteca, pero otras apps podrán verlas y ya no estarán ocultas.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Mover',
          onPress: async () => {
            setMoving(true);
            try {
              const r = await moveTracksToMusic(movableIds);
              cancelSelection();
              await reloadAppTracks();
              const parts = [`${r.moved} movida(s) a Música`];
              if (r.keptCopy > 0) parts.push(`${r.keptCopy} publicada(s) con copia (no se pudo verificar el archivo)`);
              if (r.errors.length > 0) parts.push(`${r.errors.length} con error`);
              if (r.errors.length > 0 || r.keptCopy > 0) Alert.alert('Mover a Música', `${parts.join(' · ')}.${r.errors.length ? `\n\n${r.errors.slice(0, 5).join('\n')}` : ''}`);
              else showToast(`${parts.join(' · ')}.`, 'check');
            } catch (e) {
              Alert.alert('No se pudo mover', e instanceof Error ? e.message : String(e));
            } finally {
              setMoving(false);
            }
          },
        },
      ]
    );
  }, [movableIds, cancelSelection, reloadAppTracks]);

  const hasExternalSelected = useMemo(() => [...selected].some((k) => k.startsWith('ext:')), [selected]);

  const handleImport = useCallback(async () => {
    const items = [...selected]
      .filter((k) => k.startsWith('ext:'))
      .map((k) => visibleExternal.find((item) => item.mediaAssetId === k.slice(4)))
      .filter((item): item is ExternalAudioItem => item !== undefined);
    if (items.length === 0) return;
    setImporting(true);
    const imported: ExternalAudioItem[] = [];
    const errors: string[] = [];
    try {
      for (const item of items) {
        try {
          await importExternalTrack(item);
          imported.push(item);
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
        }
      }
      cancelSelection();
      await reloadAppTracks();
    } finally {
      setImporting(false);
    }

    if (imported.length === 0) {
      Alert.alert('No se pudo importar', errors.join('\n'));
      return;
    }
    const summary = `${imported.length} canción(es) importada(s) a "Mis descargas", donde ya puedes editar título, artista y portada.${
      errors.length ? `\n\nNo se importaron ${errors.length}:\n${errors.join('\n')}` : ''
    }`;
    Alert.alert('Importación lista', `${summary}\n\n¿Eliminar también los originales de la carpeta Música?`, [
      { text: 'Conservar', style: 'cancel' },
      {
        text: 'Eliminar originales',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteExternalAssets(imported.map((item) => item.mediaAssetId));
            const gone = new Set(imported.map((item) => item.mediaAssetId));
            setExternalItems((prev) => prev.filter((item) => !gone.has(item.mediaAssetId)));
          } catch (e) {
            Alert.alert('No se pudo eliminar', e instanceof Error ? e.message : String(e));
          }
        },
      },
    ]);
  }, [selected, visibleExternal, cancelSelection, reloadAppTracks]);

  const handleShare = useCallback(async () => {
    if (!singleEditable) return;
    const track = tracks.find((t) => t.id === singleEditable);
    if (!track) return;
    try {
      await shareTrack(track);
    } catch (e) {
      Alert.alert('No se pudo compartir', e instanceof Error ? e.message : String(e));
    }
  }, [singleEditable, tracks]);

  const handleDeleteSelected = useCallback(() => {
    if (selected.size === 0) return;
    Alert.alert('Eliminar canciones', `¿Eliminar ${selected.size} canción(es) seleccionada(s)? Esta acción no se puede deshacer.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            stop();
            const deletedExternalIds = new Set<string>();
            const errors: string[] = [];
            const externalIds: string[] = [];
            for (const key of selected) {
              const sep = key.indexOf(':');
              const kind = key.slice(0, sep);
              const id = key.slice(sep + 1);
              if (kind === 'app') {
                try {
                  await deleteTrack(id);
                } catch (e) {
                  errors.push(e instanceof Error ? e.message : String(e));
                }
              } else {
                externalIds.push(id);
              }
            }
            // Todos los archivos externos en una sola petición: un único diálogo de confirmación de Android.
            if (externalIds.length > 0) {
              try {
                await deleteExternalAssets(externalIds);
                externalIds.forEach((id) => deletedExternalIds.add(id));
              } catch (e) {
                errors.push(e instanceof Error ? e.message : String(e));
              }
            }
            cancelSelection();
            await reloadAppTracks();
            if (deletedExternalIds.size > 0) {
              setExternalItems((prev) => prev.filter((item) => !deletedExternalIds.has(item.mediaAssetId)));
            }
            if (errors.length > 0) Alert.alert('No se pudo eliminar', errors.join('\n'));
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  }, [selected, stop, reloadAppTracks, cancelSelection]);

  const playlistsState = usePlaylists();

  // Agregar las canciones seleccionadas a una lista (abre la hoja "Agregar a lista").
  const handleAddToList = useCallback(() => {
    const entries = rowsRef.current
      .filter((r) => selected.has(r.key))
      .map((r) => {
        if (r.kind === 'app') {
          const track = tracks.find((t) => t.id === r.id);
          return track ? entryFromTrack(track) : null;
        }
        const m = metaRef.current[r.id];
        return entryFromExternal({ id: r.id, title: m?.title ?? r.title, artist: m?.artist ?? r.artist, coverUri: m?.cover ?? r.coverUri, fileUri: r.fileUri });
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);
    openAddToPlaylist(entries);
    cancelSelection();
  }, [selected, tracks, cancelSelection]);

  const appCount = rows.filter((r) => r.kind === 'app').length;
  const externalCount = rows.length - appCount;
  const subtitle =
    filterMode === 'playlists'
      ? `${playlistsState.playlists.length} ${playlistsState.playlists.length === 1 ? 'lista' : 'listas'}`
      : filterMode === 'all' && externalCount > 0
      ? `${rows.length} ${rows.length === 1 ? 'canción' : 'canciones'} · ${appCount} de la app · ${externalCount} fuera de ella`
      : `${rows.length} ${rows.length === 1 ? 'canción' : 'canciones'}`;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + 24 }}>
      <ScreenTitle subtitle={subtitle}>Música</ScreenTitle>

      {selectionMode ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginHorizontal: 24,
            marginTop: 4,
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
            <Pressable onPress={handleAddToList} hitSlop={8}>
              <Icon name="folder-plus" size={19} />
            </Pressable>
            {hasExternalSelected ? (
              <Pressable onPress={handleImport} disabled={importing} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Icon name="log-in" size={18} />
                <Text style={{ fontFamily: fonts.sansSemi, fontSize: 13, color: colors.ink }}>{importing ? 'Importando…' : 'Importar'}</Text>
              </Pressable>
            ) : null}
            {movableIds.length > 0 ? (
              <Pressable onPress={handleMoveToMusic} disabled={moving} hitSlop={8} style={{ opacity: moving ? 0.4 : 1 }}>
                <Icon name="folder" size={19} />
              </Pressable>
            ) : null}
            {singleEditable ? (
              <Pressable onPress={handleShare} hitSlop={8}>
                <Icon name="share-2" size={19} />
              </Pressable>
            ) : null}
            {singleEditable ? (
              <Pressable onPress={() => router.push(`/edit/${singleEditable}`)} hitSlop={8}>
                <Icon name="edit-2" size={19} />
              </Pressable>
            ) : null}
            <Pressable onPress={handleDeleteSelected} disabled={deleting} hitSlop={8}>
              <Icon name="trash-2" size={19} color={colors.accent} />
            </Pressable>
          </View>
        </View>
      ) : (
        <>
          {filterMode !== 'playlists' ? <SearchField value={query} onChangeText={setQuery} placeholder="Buscar en tu música" /> : null}
          <View style={{ marginTop: 14 }}>
            <TextTabs
              tabs={[
                { key: 'downloaded', label: 'Mis descargas' },
                { key: 'all', label: 'Todas' },
                { key: 'playlists', label: 'Listas' },
              ]}
              value={filterMode}
              onChange={setFilterMode}
              right={
                filterMode === 'playlists' ? undefined : (
                  <Pressable onPress={() => setSortMenuOpen(true)} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Icon name="bar-chart" size={15} color={colors.muted} />
                    <Text style={{ fontFamily: fonts.sansMedium, fontSize: 12, color: colors.muted }}>{SORT_LABELS[sortMode]}</Text>
                  </Pressable>
                )
              }
            />
          </View>
          {filterMode === 'all' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 24, marginTop: 10 }}>
              <Text style={{ flex: 1, fontFamily: fonts.sans, fontSize: 12, color: colors.muted }}>
                {scanning
                  ? 'Escaneando tu música…'
                  : hasScanned
                    ? `${visibleExternal.length} canción(es) fuera de la app.`
                    : 'Escanea la carpeta Music del teléfono.'}
              </Text>
              <Pressable onPress={() => scanMusicFolder()} disabled={scanning} hitSlop={8}>
                <Text
                  style={{
                    fontFamily: fonts.sansSemi,
                    fontSize: 13,
                    color: colors.ink,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.ink,
                  }}
                >
                  {scanning ? 'Escaneando…' : hasScanned ? 'Actualizar' : 'Escanear'}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </>
      )}

      {filterMode === 'playlists' ? (
        <PlaylistsPane />
      ) : (
      <FlatList
        style={{ flex: 1, marginTop: 8 }}
        data={rows}
        keyExtractor={(row) => row.key}
        initialNumToRender={14}
        maxToRenderPerBatch={12}
        windowSize={7}
        removeClippedSubviews
        getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
        extraData={listExtra}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListHeaderComponent={
          externalError ? (
            <Text style={{ marginHorizontal: 24, marginBottom: 8, fontFamily: fonts.sans, fontSize: 13, color: colors.accent }}>
              {externalError}
            </Text>
          ) : null
        }
        ListEmptyComponent={
          !scanning ? (
            <Text style={{ paddingHorizontal: 24, paddingVertical: 24, fontFamily: fonts.serifItalic, fontSize: 15, color: colors.muted }}>
              {query
                ? 'Ninguna canción coincide con la búsqueda.'
                : filterMode === 'all'
                  ? hasScanned
                    ? 'No se encontraron canciones en Music.'
                    : 'Toca "Escanear" para ver todas las canciones de Music.'
                  : 'Aún no has descargado ninguna canción.'}
            </Text>
          ) : null
        }
        renderItem={({ item, index }) => {
          const m = item.kind === 'external' ? meta[item.id] : undefined;
          return (
          <TrackRow
            rowKey={item.key}
            index={index}
            title={m?.title ?? item.title}
            subtitle={
              item.kind === 'app' ? item.artist : `${m?.artist ?? item.artist} · fuera de la app · mantén pulsado para importar`
            }
            coverUri={m?.cover ?? item.coverUri}
            seed={item.key}
            active={currentId === item.key}
            activeState={currentId === item.key ? currentState : undefined}
            selecting={selectionMode}
            selected={selected.has(item.key)}
            onPressRow={onRowPress}
            onLongPressRow={onRowLongPress}
          />
          );
        }}
      />
      )}

      <Modal visible={sortMenuOpen} animationType="fade" transparent onRequestClose={() => setSortMenuOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(20,33,43,0.4)' }} onPress={() => setSortMenuOpen(false)} />
        <View style={{ backgroundColor: colors.bg, paddingHorizontal: 24, paddingTop: 20, paddingBottom: insets.bottom + 20 }}>
          <Text style={{ fontFamily: fonts.sansMedium, fontSize: 11, letterSpacing: 1.4, color: colors.muted, marginBottom: 6 }}>
            ORDENAR POR
          </Text>
          {SORT_MODES.map((mode) => {
            const active = sortMode === mode;
            return (
              <Pressable
                key={mode}
                onPress={() => {
                  setSortMode(mode);
                  setSortMenuOpen(false);
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
                <Text style={{ fontFamily: fonts.serif, fontSize: 18, color: active ? colors.accent : colors.ink }}>
                  {SORT_LABELS[mode]}
                </Text>
                {active ? <Icon name="check" size={18} color={colors.accent} /> : null}
              </Pressable>
            );
          })}
        </View>
      </Modal>
    </View>
  );
}
