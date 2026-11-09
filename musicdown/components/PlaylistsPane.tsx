import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, PanResponder, Pressable, Text, TextInput, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { usePlayerSelection } from '../lib/backgroundPlayer';
import { listTracks } from '../lib/library';
import { isEntryAvailable, resolveEntries } from '../lib/playlistPlayback';
import { usePowerPrefs } from '../lib/powerPrefs';
import { showToast } from '../lib/toast';
import {
  createPlaylist,
  deletePlaylist,
  LIKED_ID,
  moveEntry,
  removeEntry,
  renamePlaylist,
  usePlaylists,
  type Playlist,
  type PlaylistEntry,
} from '../lib/playlists';
import { colors, fonts } from '../lib/theme';
import { Cover, HeartIcon, Icon, TrackRow } from './ui';

const ROW_HEIGHT = 69;

// ---------- Lista de playlists ----------

function PlaylistRow({ playlist, onOpen }: { playlist: Playlist; onOpen: () => void }) {
  const first = playlist.entries.find((e) => e.image)?.image ?? null;
  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => ({ height: ROW_HEIGHT, backgroundColor: pressed ? 'rgba(20,33,43,0.04)' : 'transparent' })}
    >
      <View
        style={{
          flex: 1,
          marginHorizontal: 24,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          borderBottomWidth: 1,
          borderBottomColor: colors.line,
        }}
      >
        {playlist.id === LIKED_ID ? (
          <View style={{ width: 44, height: 44, borderRadius: 3, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
            <HeartIcon filled size={22} color={colors.white} />
          </View>
        ) : first ? (
          <Cover uri={first} size={44} seed={playlist.id} />
        ) : (
          <View style={{ width: 44, height: 44, borderRadius: 3, backgroundColor: colors.cover, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="list" size={20} color={colors.white} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ fontFamily: fonts.serif, fontSize: 17, color: colors.ink }}>
            {playlist.name}
          </Text>
          <Text numberOfLines={1} style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.muted }}>
            {playlist.entries.length} {playlist.entries.length === 1 ? 'canción' : 'canciones'}
          </Text>
        </View>
        <Icon name="chevron-right" size={18} color={colors.muted} />
      </View>
    </Pressable>
  );
}

// ---------- Fila con arrastre ----------

interface EntryRowProps {
  entry: PlaylistEntry;
  index: number;
  available: boolean;
  /** Está en la lista pero sin descargar y no hay conexión (modo sin conexión): se ve atenuada y bloqueada. */
  blockedOffline: boolean;
  active: boolean;
  /** Desplazamiento (px) que hace sitio a la fila arrastrada. */
  shift: number;
  dragging: boolean;
  /** Desplazamiento de la fila arrastrada (sigue al dedo). */
  dragY: number;
  onPlay: (key: string) => void;
  onRemove: (key: string) => void;
  onDragStart: (index: number) => void;
  onDragMove: (dy: number, moveY: number) => void;
  onDragEnd: () => void;
}

const EntryRow = memo(function EntryRow(props: EntryRowProps) {
  const { entry, index, available, blockedOffline, active, shift, dragging, dragY, onPlay, onRemove } = props;
  // Los manejadores del gesto se crean una vez y leen siempre las propiedades más recientes.
  const latest = useRef(props);
  latest.current = props;
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => latest.current.onDragStart(latest.current.index),
      onPanResponderMove: (_, g) => latest.current.onDragMove(g.dy, g.moveY),
      onPanResponderRelease: () => latest.current.onDragEnd(),
      onPanResponderTerminate: () => latest.current.onDragEnd(),
    })
  ).current;

  return (
    <View
      style={{
        zIndex: dragging ? 20 : 0,
        elevation: dragging ? 8 : 0,
        backgroundColor: dragging ? colors.bg : 'transparent',
        opacity: available && !blockedOffline ? 1 : 0.45,
        transform: [{ translateY: dragging ? dragY : shift }],
      }}
    >
      <TrackRow
        index={index}
        title={entry.title}
        subtitle={blockedOffline ? `${entry.artist} · sin descargar` : available ? entry.artist : `${entry.artist} · no disponible`}
        coverUri={entry.image}
        seed={entry.key}
        active={active}
        activeState={active ? 'playing' : undefined}
        onPress={available || blockedOffline ? () => onPlay(entry.key) : undefined}
        trailing={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Pressable onPress={() => onRemove(entry.key)} hitSlop={10}>
              <Icon name="x" size={18} color={colors.muted} />
            </Pressable>
            <View {...pan.panHandlers} style={{ paddingVertical: 12, paddingHorizontal: 4 }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 6 }}>
              <Icon name="menu" size={20} color={colors.ink} />
            </View>
          </View>
        }
      />
    </View>
  );
});

// ---------- Detalle de una playlist ----------

function PlaylistDetail({ playlist, onBack }: { playlist: Playlist; onBack: () => void }) {
  const { currentId, playQueue } = usePlayerSelection();
  const [localIds, setLocalIds] = useState<ReadonlySet<string>>(new Set());
  const [spotifyToLocal, setSpotifyToLocal] = useState<ReadonlyMap<string, string>>(new Map());
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(playlist.name);

  // Qué descargas existen (para marcar "no disponible" y para resaltar la que suena).
  useEffect(() => {
    let alive = true;
    listTracks().then((tracks) => {
      if (!alive) return;
      setLocalIds(new Set(tracks.map((t) => t.id)));
      setSpotifyToLocal(new Map(tracks.filter((t) => t.spotifyId).map((t) => [t.spotifyId as string, t.id])));
    });
    return () => {
      alive = false;
    };
  }, [playlist.entries.length]);

  const offline = usePowerPrefs().offlineMode;

  const playFrom = useCallback(
    async (startKey?: string) => {
      const all = await resolveEntries(playlist.entries);
      // Modo sin conexión: solo suena lo que está en el teléfono (archivos locales).
      const resolved = offline ? all.filter((r) => r.item.kind === 'local') : all;
      if (resolved.length === 0) {
        if (offline && all.length > 0) showToast('Sin conexión: ninguna canción de esta lista está descargada', 'wifi-off');
        else Alert.alert('Lista vacía', 'Ninguna canción de esta lista está disponible para reproducir.');
        return;
      }
      const found = startKey ? resolved.findIndex((r) => r.entry.key === startKey) : 0;
      if (startKey && found < 0) {
        showToast('Sin conexión: descarga esta canción para escucharla', 'wifi-off');
        return;
      }
      playQueue(resolved.map((r) => r.item), Math.max(0, found));
    },
    [playlist.entries, playQueue, offline]
  );

  const onPlay = useCallback((key: string) => playFrom(key), [playFrom]);
  const onBlocked = useCallback(() => showToast('Sin conexión: descarga esta canción para escucharla', 'wifi-off'), []);
  const onRemove = useCallback((key: string) => removeEntry(playlist.id, key), [playlist.id]);

  // ---- Arrastrar para reordenar ----
  const [drag, setDrag] = useState<{ from: number; dy: number } | null>(null);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const listRef = useRef<FlatList<PlaylistEntry>>(null);
  const boxRef = useRef<View>(null);
  const box = useRef({ top: 0, bottom: 0, height: 0 });
  const scrollOffset = useRef(0);
  const gestureDy = useRef(0);
  const scrolled = useRef(0);
  const moveY = useRef(0);
  const auto = useRef<ReturnType<typeof setInterval> | null>(null);
  const count = playlist.entries.length;

  const stopAuto = () => {
    if (auto.current) clearInterval(auto.current);
    auto.current = null;
  };
  useEffect(() => stopAuto, []);

  const onDragStart = useCallback(
    (index: number) => {
      gestureDy.current = 0;
      scrolled.current = 0;
      setScrollEnabled(false);
      setDrag({ from: index, dy: 0 });
      boxRef.current?.measureInWindow((_x, y, _w, h) => {
        box.current = { top: y, bottom: y + h, height: h };
      });
      // Desplazamiento automático cuando el dedo se acerca al borde superior o inferior de la lista.
      stopAuto();
      auto.current = setInterval(() => {
        const { top, bottom, height } = box.current;
        if (height === 0 || !dragRef.current) return;
        let delta = 0;
        if (moveY.current < top + 70) delta = -10;
        else if (moveY.current > bottom - 70) delta = 10;
        if (delta === 0) return;
        const max = Math.max(0, count * ROW_HEIGHT - height);
        const next = Math.max(0, Math.min(max, scrollOffset.current + delta));
        const applied = next - scrollOffset.current;
        if (applied === 0) return;
        scrollOffset.current = next;
        scrolled.current += applied;
        listRef.current?.scrollToOffset({ offset: next, animated: false });
        setDrag((d) => (d ? { ...d, dy: gestureDy.current + scrolled.current } : d));
      }, 16);
    },
    [count]
  );

  const onDragMove = useCallback((dy: number, y: number) => {
    gestureDy.current = dy;
    moveY.current = y;
    setDrag((d) => (d ? { ...d, dy: dy + scrolled.current } : d));
  }, []);

  const onDragEnd = useCallback(() => {
    stopAuto();
    const d = dragRef.current;
    if (d) {
      const to = Math.max(0, Math.min(count - 1, Math.round(d.from + d.dy / ROW_HEIGHT)));
      if (to !== d.from) moveEntry(playlist.id, d.from, to);
    }
    setDrag(null);
    setScrollEnabled(true);
  }, [count, playlist.id]);

  const target = drag ? Math.max(0, Math.min(count - 1, Math.round(drag.from + drag.dy / ROW_HEIGHT))) : -1;

  // ¿Está descargada (suena sin internet)? Archivos externos, descargas de la app o likes ya bajados.
  const isDownloaded = (e: PlaylistEntry) =>
    Boolean(e.assetId && e.fileUri) ||
    (e.trackId !== undefined && localIds.has(e.trackId)) ||
    (e.spotifyId !== undefined && spotifyToLocal.has(e.spotifyId));
  // Sin conexión, lo que no está descargado queda atenuado y bloqueado (como en los likes de Spotify).
  const offlineBlocked = (e: PlaylistEntry) => offline && !isDownloaded(e);

  const activeIds = useMemo(() => new Set([currentId]), [currentId]);
  const isActive = (e: PlaylistEntry) => {
    if (!currentId) return false;
    const localOfSpotify = e.spotifyId ? spotifyToLocal.get(e.spotifyId) : undefined;
    return (
      activeIds.has(e.trackId ? `app:${e.trackId}` : '') ||
      (e.spotifyId !== undefined && activeIds.has(e.spotifyId)) ||
      (localOfSpotify !== undefined && activeIds.has(`app:${localOfSpotify}`)) ||
      (e.assetId !== undefined && activeIds.has(`ext:${e.assetId}`))
    );
  };

  const confirmDelete = () =>
    Alert.alert('Eliminar lista', `¿Eliminar "${playlist.name}"? Las canciones no se borran, solo la lista.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: () => {
          deletePlaylist(playlist.id);
          onBack();
        },
      },
    ]);

  const saveName = () => {
    renamePlaylist(playlist.id, draftName);
    setRenaming(false);
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 24, marginTop: 6 }}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Icon name="chevron-left" size={26} />
        </Pressable>
        {renaming ? (
          <TextInput
            value={draftName}
            onChangeText={setDraftName}
            autoFocus
            onSubmitEditing={saveName}
            style={{ flex: 1, fontFamily: fonts.serifBold, fontSize: 24, color: colors.ink, borderBottomWidth: 1, borderBottomColor: colors.ink, paddingVertical: 4 }}
          />
        ) : (
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.serifBold, fontSize: 26, color: colors.ink }}>
            {playlist.name}
          </Text>
        )}
        {playlist.id !== LIKED_ID ? (
          renaming ? (
            <Pressable onPress={saveName} hitSlop={10}>
              <Icon name="check" size={20} color={colors.accent} />
            </Pressable>
          ) : (
            <>
              <Pressable
                onPress={() => {
                  setDraftName(playlist.name);
                  setRenaming(true);
                }}
                hitSlop={10}
              >
                <Icon name="edit-2" size={18} />
              </Pressable>
              <Pressable onPress={confirmDelete} hitSlop={10}>
                <Icon name="trash-2" size={18} color={colors.accent} />
              </Pressable>
            </>
          )
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 24, marginTop: 10, marginBottom: 6 }}>
        <Pressable
          onPress={() => playFrom()}
          disabled={count === 0}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            height: 42,
            paddingHorizontal: 18,
            borderRadius: 21,
            backgroundColor: colors.accent,
            opacity: count === 0 ? 0.4 : 1,
          }}
        >
          <Icon name="play" size={16} color={colors.white} />
          <Text style={{ fontFamily: fonts.sansSemi, fontSize: 14, color: colors.white }}>Reproducir</Text>
        </Pressable>
        <Text style={{ flexShrink: 1, fontFamily: fonts.sans, fontSize: 13, color: colors.muted }}>
          {count} {count === 1 ? 'canción' : 'canciones'}
        </Text>
      </View>
      {count > 1 ? (
        <Text style={{ paddingHorizontal: 24, marginBottom: 4, fontFamily: fonts.serifItalic, fontSize: 12, color: colors.muted }}>
          Para reordenar, mantén pulsado el ícono de las tres rayas y arrastra.
        </Text>
      ) : null}

      <View
        ref={boxRef}
        style={{ flex: 1 }}
        onLayout={() =>
          boxRef.current?.measureInWindow((_x, y, _w, h) => {
            box.current = { top: y, bottom: y + h, height: h };
          })
        }
      >
        <FlatList
          ref={listRef}
          data={playlist.entries}
          keyExtractor={(e) => e.key}
          scrollEnabled={scrollEnabled}
          removeClippedSubviews={false}
          initialNumToRender={14}
          windowSize={9}
          scrollEventThrottle={16}
          onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
            scrollOffset.current = e.nativeEvent.contentOffset.y;
          }}
          getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
          extraData={drag}
          ListEmptyComponent={
            <Text style={{ paddingHorizontal: 24, paddingVertical: 24, fontFamily: fonts.serifItalic, fontSize: 15, color: colors.muted }}>
              {playlist.id === LIKED_ID
                ? 'Toca el corazón en el reproductor para agregar canciones aquí.'
                : 'Agrega canciones desde el reproductor, desde Spotify o con la selección múltiple de Música.'}
            </Text>
          }
          renderItem={({ item, index }) => {
            let shift = 0;
            if (drag && index !== drag.from) {
              if (drag.from < target && index > drag.from && index <= target) shift = -ROW_HEIGHT;
              else if (drag.from > target && index >= target && index < drag.from) shift = ROW_HEIGHT;
            }
            return (
              <EntryRow
                entry={item}
                index={index}
                available={isEntryAvailable(item, localIds) && !offlineBlocked(item)}
                blockedOffline={offlineBlocked(item)}
                active={isActive(item)}
                shift={shift}
                dragging={drag?.from === index}
                dragY={drag?.from === index ? drag.dy : 0}
                onPlay={offlineBlocked(item) ? onBlocked : onPlay}
                onRemove={onRemove}
                onDragStart={onDragStart}
                onDragMove={onDragMove}
                onDragEnd={onDragEnd}
              />
            );
          }}
        />
      </View>
    </View>
  );
}

// ---------- Panel principal ----------

/** Contenido de Música > Listas: todas las playlists y el detalle de la elegida. */
export function PlaylistsPane() {
  const { playlists } = usePlaylists();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const open = openId ? playlists.find((p) => p.id === openId) : undefined;
  if (open) return <PlaylistDetail playlist={open} onBack={() => setOpenId(null)} />;

  const create = () => {
    const id = createPlaylist(name);
    setName('');
    setCreating(false);
    setOpenId(id);
  };

  return (
    <View style={{ flex: 1 }}>
      {creating ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 24, marginTop: 8, borderBottomWidth: 1, borderBottomColor: colors.ink }}>
          <Icon name="plus" size={18} />
          <TextInput
            value={name}
            onChangeText={setName}
            autoFocus
            placeholder="Nombre de la lista"
            placeholderTextColor={colors.faint}
            onSubmitEditing={create}
            style={{ flex: 1, paddingVertical: 12, fontFamily: fonts.sans, fontSize: 16, color: colors.ink }}
          />
          <Pressable onPress={create} hitSlop={8}>
            <Text style={{ fontFamily: fonts.sansSemi, fontSize: 14, color: colors.accent }}>Crear</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={() => setCreating(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 24, marginTop: 8, paddingVertical: 12 }}>
          <Icon name="plus" size={18} />
          <Text style={{ fontFamily: fonts.sansSemi, fontSize: 15, color: colors.ink }}>Nueva lista</Text>
        </Pressable>
      )}
      <FlatList
        data={playlists}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => <PlaylistRow playlist={item} onOpen={() => setOpenId(item.id)} />}
      />
    </View>
  );
}
