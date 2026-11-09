import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, PanResponder, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LyricsPanel } from '../components/LyricsPanel';
import { ToastHost } from '../components/ToastHost';
import { Cover, HeartIcon, Icon, LoadingDots, type IconName } from '../components/ui';
import { useBackgroundPlayer } from '../lib/backgroundPlayer';
import { prefetchColors } from '../lib/coverColor';
import { useCoverBackground } from '../lib/coverTheme';
import { openAddToPlaylist } from '../lib/playlistSheet';
import { entryFromPlayerItem, toggleLike, usePlaylists } from '../lib/playlists';
import { colors, fonts } from '../lib/theme';
import { showToast } from '../lib/toast';
import { confirmDeleteItem } from '../lib/trackActions';

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '0:00';
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** Botón de ícono sin fondo (zona táctil de `box` px). */
function IconButton({
  name,
  onPress,
  color = colors.ink,
  size = 26,
  box = 56,
  label,
  children,
}: {
  name?: IconName;
  onPress: () => void;
  color?: string;
  size?: number;
  box?: number;
  label: string;
  children?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: box,
        height: box,
        borderRadius: box / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? 'rgba(20,33,43,0.06)' : 'transparent',
      })}
    >
      {children ?? (name ? <Icon name={name} size={size} color={color} /> : null)}
    </Pressable>
  );
}

/** Pausa del diseño: dos trazos verticales finos con puntas redondeadas. */
function PauseGlyph({ color, size = 30 }: { color: string; size?: number }) {
  const bar = { width: (1.7 * size) / 24 + 0.6, height: (14 * size) / 24, borderRadius: 2, backgroundColor: color } as const;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: (6 * size) / 24 - 1 }}>
      <View style={bar} />
      <View style={bar} />
    </View>
  );
}

/**
 * Barra de progreso del diseño: línea de 2 px (tinta sobre #CBD2D6) y círculo terracota de 16 px.
 * Se puede tocar o arrastrar en cualquier punto de su altura (44 px).
 */
function ProgressBar({
  value,
  max,
  onScrub,
  onSeek,
  trackColor,
}: {
  trackColor: string;
  value: number;
  max: number;
  onScrub: (v: number) => void;
  onSeek: (v: number) => void;
}) {
  const [barWidth, setBarWidth] = useState(0);
  const latest = useRef({ barWidth, max, onScrub, onSeek });
  latest.current = { barWidth, max, onScrub, onSeek };
  const startX = useRef(0);

  const valueAt = (x: number) => {
    const { barWidth: w, max: m } = latest.current;
    return w > 0 ? clamp(x / w, 0, 1) * m : 0;
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        startX.current = e.nativeEvent.locationX;
        latest.current.onScrub(valueAt(startX.current));
      },
      onPanResponderMove: (_, g) => latest.current.onScrub(valueAt(startX.current + g.dx)),
      onPanResponderRelease: (_, g) => latest.current.onSeek(valueAt(startX.current + g.dx)),
      onPanResponderTerminate: (_, g) => latest.current.onSeek(valueAt(startX.current + g.dx)),
    })
  ).current;

  const ratio = max > 0 ? clamp(value / max, 0, 1) : 0;
  return (
    <View
      {...pan.panHandlers}
      onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
      style={{ height: 44, justifyContent: 'center', marginBottom: -12 }}
    >
      <View pointerEvents="none" style={{ height: 2, backgroundColor: trackColor }} />
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, width: `${ratio * 100}%`, height: 2, backgroundColor: colors.ink }} />
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: `${ratio * 100}%`, width: 16, height: 16, marginLeft: -8, borderRadius: 8, backgroundColor: colors.accent }}
      />
    </View>
  );
}

/** Retroceder / adelantar 10 segundos: flecha circular con "10" en el centro. */
function SeekButton({ direction, onPress }: { direction: 'back' | 'forward'; onPress: () => void }) {
  return (
    <IconButton box={44} onPress={onPress} label={direction === 'back' ? 'Retroceder 10 segundos' : 'Adelantar 10 segundos'}>
      <View style={{ width: 26, height: 26, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={direction === 'back' ? 'rotate-ccw' : 'rotate-cw'} size={26} />
        <Text style={{ position: 'absolute', fontFamily: fonts.sansSemi, fontSize: 7.5, color: colors.ink, marginTop: 1 }}>10</Text>
      </View>
    </IconButton>
  );
}

/**
 * Borde que se desvanece (arriba o abajo) sobre la letra, como la máscara de degradado del diseño.
 * Se aproxima con franjas del color del fondo cuya opacidad baja gradualmente.
 */
function FadeEdge({ edge, height, rgb }: { edge: 'top' | 'bottom'; height: number; rgb: [number, number, number] }) {
  const steps = 16;
  const strip = height / steps;
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: 0, right: 0, [edge]: 0, height, flexDirection: 'column' }}
    >
      {Array.from({ length: steps }, (_, i) => {
        // De opaco (en el borde) a transparente (hacia el centro).
        const k = edge === 'top' ? i : steps - 1 - i;
        const alpha = 1 - k / (steps - 1);
        return <View key={i} style={{ height: strip, backgroundColor: `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha.toFixed(3)})` }} />;
      })}
    </View>
  );
}

function MenuItem({ icon, label, onPress, danger }: { icon: IconName; label: string; onPress: () => void; danger?: boolean }) {
  const color = danger ? colors.accent : colors.ink;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        height: 60,
        borderBottomWidth: 1,
        borderBottomColor: colors.line,
        backgroundColor: pressed ? 'rgba(20,33,43,0.04)' : 'transparent',
      })}
    >
      <Icon name={icon} size={22} color={color} />
      <Text style={{ fontFamily: fonts.serifMedium, fontSize: 18, color }}>{label}</Text>
    </Pressable>
  );
}

export default function PlayerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const player = useBackgroundPlayer();
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubValue, setScrubValue] = useState(0);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [lyricsHeight, setLyricsHeight] = useState(0);
  const [jumpToCurrent, setJumpToCurrent] = useState<(() => void) | null>(null);
  const [jumpDirection, setJumpDirection] = useState<'up' | 'down'>('down');
  const [menuOpen, setMenuOpen] = useState(false);

  const track = player.current;
  // Fondo con el tono de la carátula (Ajustes → Temas).
  const bg = useCoverBackground(track?.image);
  // Precarga el color de las canciones vecinas para que el cambio de fondo no llegue tarde.
  useEffect(() => {
    const { queue, index } = player;
    prefetchColors([queue[index + 1]?.image, queue[index - 1]?.image, queue[index + 2]?.image]);
  }, [player.queue, player.index]);
  const { likedKeys } = usePlaylists();
  const entry = track ? entryFromPlayerItem(track) : null;
  const liked = entry ? likedKeys.has(entry.key) : false;
  const isPlaying = player.status === 'playing' || player.status === 'ad' || player.status === 'loading';
  const position = scrubbing ? scrubValue : player.position;
  const isApp = track?.id.startsWith('app:') ?? false;

  // Alto de la carátula: 326 px como en el diseño; en pantallas bajas se reduce. El resto de la pantalla
  // (cabecera, título, progreso, tiempos, controles y barra "Ver letra") suma 401 px, más 16 de reserva.
  const BAR_HEIGHT = 64;
  const coverHeight = clamp(height - insets.top - insets.bottom - 401 - 16, 190, 326);
  const coverWidth = width - 56;

  // Doble toque sobre la carátula = me gusta (o quitarlo si ya estaba). Un corazón aparece un instante sobre la imagen.
  const lastTap = useRef(0);
  const heart = useRef(new Animated.Value(0)).current;
  const [heartFilled, setHeartFilled] = useState(true);

  const popHeart = (filled: boolean) => {
    setHeartFilled(filled);
    heart.stopAnimation();
    heart.setValue(0);
    Animated.sequence([
      Animated.timing(heart, { toValue: 1, duration: 160, useNativeDriver: true }),
      Animated.delay(380),
      Animated.timing(heart, { toValue: 0, duration: 240, useNativeDriver: true }),
    ]).start();
  };

  const onLike = (): boolean => {
    if (!entry) return false;
    const nowLiked = toggleLike(entry);
    showToast(nowLiked ? 'Agregada a tus me gusta' : 'Quitada de tus me gusta', 'heart', {
      actionLabel: 'Deshacer',
      onAction: () => {
        toggleLike(entry);
      },
    });
    return nowLiked;
  };

  const onCoverPress = () => {
    const now = Date.now();
    if (now - lastTap.current < 320) {
      lastTap.current = 0;
      popHeart(onLike());
    } else {
      lastTap.current = now;
    }
  };

  return (
    <Animated.View style={{ flex: 1, backgroundColor: bg.animated, paddingTop: insets.top + 8 }}>
      {/* Cabecera: cerrar · REPRODUCIENDO · más opciones */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 }}>
        <IconButton name="chevron-down" size={22} box={48} label="Cerrar" onPress={() => router.back()} />
        <Text style={{ fontFamily: fonts.sansSemi, fontSize: 11, letterSpacing: 0.9, color: colors.muted }}>REPRODUCIENDO</Text>
        <IconButton name="more-horizontal" size={22} box={48} label="Más opciones" onPress={() => setMenuOpen(true)} />
      </View>

      {track ? (
        <View style={{ paddingHorizontal: 28, gap: 12 }}>
          {/* Carátula (doble toque = me gusta) */}
          <Pressable onPress={onCoverPress} accessibilityLabel="Doble toque para dar me gusta" style={{ marginTop: 16 }}>
            <Cover uri={track.image} size={coverWidth} height={coverHeight} seed={track.id} radius={4} />
            <Animated.View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: heart,
                transform: [{ scale: heart.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.05] }) }],
              }}
            >
              <HeartIcon filled={heartFilled} size={112} color="#FFFFFF" />
            </Animated.View>
          </Pressable>

          {/* Título y artista (con un corazón terracota si la canción está en "Me Gustan") */}
          <View style={{ marginTop: 4 }}>
            <Text numberOfLines={1} style={{ fontFamily: fonts.serif, fontSize: 30, lineHeight: 33, letterSpacing: -0.6, color: colors.ink }}>
              {track.title}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.serifItalicMedium, fontSize: 17, color: colors.muted }}>
                {player.status === 'error' ? player.error : track.artist}
              </Text>
              {liked ? <HeartIcon filled size={16} /> : null}
            </View>
          </View>

          {/* Progreso */}
          <ProgressBar
            trackColor={bg.line}
            value={position}
            max={player.duration || 1}
            onScrub={(v) => {
              setScrubbing(true);
              setScrubValue(v);
            }}
            onSeek={(v) => {
              player.seekTo(v);
              setScrubbing(false);
            }}
          />

          {/* Tiempos con los saltos de 10 s a cada lado */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: -8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <SeekButton direction="back" onPress={() => player.seekBy(-10)} />
              <Text style={{ fontFamily: fonts.sansMedium, fontSize: 12, color: colors.muted }}>{formatTime(position)}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <Text style={{ fontFamily: fonts.sansMedium, fontSize: 12, color: colors.muted }}>{formatTime(player.duration)}</Text>
              <SeekButton direction="forward" onPress={() => player.seekBy(10)} />
            </View>
          </View>

          {/* Controles: aleatorio · anterior · play · siguiente · repetir */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
            <IconButton
              name="shuffle"
              size={22}
              box={48}
              label="Aleatorio"
              color={player.shuffle ? colors.accent : colors.muted}
              onPress={player.toggleShuffle}
            />
            <IconButton name="skip-back" label="Anterior" onPress={player.previous} />
            <Pressable
              onPress={player.togglePlay}
              accessibilityLabel={isPlaying ? 'Pausar' : 'Reproducir'}
              style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}
            >
              {player.status === 'loading' ? (
                <LoadingDots color={colors.white} size={6} />
              ) : isPlaying ? (
                <PauseGlyph color={colors.white} />
              ) : (
                <Icon name="play" size={30} color={colors.white} />
              )}
            </Pressable>
            <IconButton name="skip-forward" label="Siguiente" onPress={player.next} />
            <IconButton box={48} label="Repetir" onPress={player.cycleRepeat}>
              <View>
                <Icon name="repeat" size={22} color={player.repeat === 'off' ? colors.muted : colors.accent} />
                {player.repeat === 'one' ? (
                  <Text style={{ position: 'absolute', right: -6, top: -7, fontFamily: fonts.sansSemi, fontSize: 10, color: colors.accent }}>1</Text>
                ) : null}
              </View>
            </IconButton>
          </View>
        </View>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: fonts.serifItalic, fontSize: 16, color: colors.muted }}>No hay nada reproduciéndose.</Text>
        </View>
      )}

      {/* Barra inferior "Ver letra" */}
      {track ? (
        <Pressable
          onPress={() => setLyricsOpen(true)}
          accessibilityLabel="Ver letra"
          style={({ pressed }) => ({
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: BAR_HEIGHT + insets.bottom,
            paddingBottom: 8 + insets.bottom,
            // Línea divisoria casi imperceptible (antes era el gris completo de las demás líneas).
            borderTopWidth: 1,
            borderTopColor: 'rgba(20, 33, 43, 0.06)',
            backgroundColor: pressed ? bg.pressed : bg.target,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          })}
        >
          <Icon name="chevron-up" size={20} color={colors.ink} />
          <Text style={{ fontFamily: fonts.sansSemi, fontSize: 14, color: colors.ink }}>Letra</Text>
        </Pressable>
      ) : null}

      {/* Letra a pantalla completa (diseño "Letra mejorada") */}
      <Modal visible={lyricsOpen} animationType="slide" statusBarTranslucent onRequestClose={() => setLyricsOpen(false)}>
        <View style={{ flex: 1, backgroundColor: bg.target, paddingTop: insets.top + 8 }}>
          {/* Cabecera: cerrar · título y artista · más opciones */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 }}>
            <IconButton name="chevron-down" size={22} box={48} label="Cerrar letra" onPress={() => setLyricsOpen(false)} />
            <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 8 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.serif, fontSize: 17, color: colors.ink }}>
                {track?.title ?? ''}
              </Text>
              <Text numberOfLines={1} style={{ marginTop: 2, fontFamily: fonts.sansMedium, fontSize: 12, color: colors.muted }}>
                {track?.artist ?? ''}
              </Text>
            </View>
            <IconButton name="more-horizontal" size={22} box={48} label="Más opciones" onPress={() => setMenuOpen(true)} />
          </View>

          {/* Letra con los bordes superior e inferior desvanecidos */}
          <View style={{ flex: 1 }} onLayout={(e) => setLyricsHeight(e.nativeEvent.layout.height)}>
            {track && lyricsHeight > 0 ? (
              <View style={{ paddingHorizontal: 20 }}>
                <LyricsPanel
                  trackId={track.id}
                  title={track.title}
                  artist={track.artist}
                  duration={player.duration}
                  position={player.position}
                  height={lyricsHeight}
                  onSeek={player.seekTo}
                  onJumpChange={(fn, direction) => {
                    setJumpToCurrent(fn ? () => fn : null);
                    setJumpDirection(direction);
                  }}
                />
              </View>
            ) : null}
            {lyricsHeight > 0 ? <FadeEdge edge="top" height={lyricsHeight * 0.14} rgb={bg.rgb} /> : null}
            {lyricsHeight > 0 ? <FadeEdge edge="bottom" height={lyricsHeight * 0.18} rgb={bg.rgb} /> : null}

            {/* "Línea actual": va después del desvanecido para que se vea nítido */}
            {jumpToCurrent ? (
              <Pressable
                onPress={jumpToCurrent}
                style={{
                  position: 'absolute',
                  bottom: 12,
                  alignSelf: 'center',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  height: 44,
                  paddingHorizontal: 18,
                  borderRadius: 22,
                  backgroundColor: colors.ink,
                  shadowColor: '#14212B',
                  shadowOffset: { width: 0, height: 6 },
                  shadowOpacity: 0.25,
                  shadowRadius: 10,
                  elevation: 6,
                }}
              >
                <Icon name={jumpDirection === 'up' ? 'chevron-up' : 'chevron-down'} size={18} color={colors.white} />
                <Text style={{ fontFamily: fonts.sansSemi, fontSize: 13, color: colors.white }}>Línea actual</Text>
              </Pressable>
            ) : null}
          </View>

          {/* Progreso con −10 s y +10 s a los lados de los tiempos */}
          {track ? (
            <View style={{ paddingHorizontal: 28 }}>
              <ProgressBar
            trackColor={bg.line}
                value={position}
                max={player.duration || 1}
                onScrub={(v) => {
                  setScrubbing(true);
                  setScrubValue(v);
                }}
                onSeek={(v) => {
                  player.seekTo(v);
                  setScrubbing(false);
                }}
              />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: -8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                  <SeekButton direction="back" onPress={() => player.seekBy(-10)} />
                  <Text style={{ fontFamily: fonts.sansMedium, fontSize: 12, color: colors.muted }}>{formatTime(position)}</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                  <Text style={{ fontFamily: fonts.sansMedium, fontSize: 12, color: colors.muted }}>{formatTime(player.duration)}</Text>
                  <SeekButton direction="forward" onPress={() => player.seekBy(10)} />
                </View>
              </View>
            </View>
          ) : null}

          {/* Pie: canción, pausa y siguiente (sin salir de la letra) */}
          {track ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingTop: 10,
                paddingHorizontal: 20,
                paddingBottom: Math.max(28, insets.bottom + 12),
                borderTopWidth: 1,
                borderTopColor: colors.line,
              }}
            >
              <Cover uri={track.image} size={48} seed={track.id} radius={4} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ fontFamily: fonts.serifMedium, fontSize: 16, color: colors.ink }}>
                  {track.title}
                </Text>
                <Text numberOfLines={1} style={{ marginTop: 2, fontFamily: fonts.sans, fontSize: 12, color: colors.muted }}>
                  {track.artist}
                </Text>
              </View>
              <IconButton box={48} label={isPlaying ? 'Pausar' : 'Reproducir'} onPress={player.togglePlay}>
                {isPlaying ? <PauseGlyph color={colors.ink} size={22} /> : <Icon name="play" size={22} />}
              </IconButton>
              <IconButton name="skip-forward" size={22} box={48} label="Siguiente" onPress={player.next} />
            </View>
          ) : null}
        </View>
      </Modal>

      {/* Menú ⋯ */}
      <Modal visible={menuOpen} transparent animationType="slide" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(20,33,43,0.55)' }} onPress={() => setMenuOpen(false)} />
        <View
          style={{
            backgroundColor: bg.target,
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            paddingTop: 20,
            paddingHorizontal: 24,
            paddingBottom: insets.bottom + 20,
          }}
        >
          <Text
            numberOfLines={1}
            style={{ marginBottom: 4, fontFamily: fonts.sansSemi, fontSize: 11, letterSpacing: 0.9, color: colors.muted }}
          >
            {track ? `${track.title} · ${track.artist}`.toUpperCase() : ''}
          </Text>
          <MenuItem
            icon="plus-circle"
            label="Agregar a una lista"
            onPress={() => {
              setMenuOpen(false);
              if (entry) openAddToPlaylist([entry]);
            }}
          />
          {isApp && track ? (
            <MenuItem
              icon="edit-2"
              label="Editar canción"
              onPress={() => {
                setMenuOpen(false);
                router.push(`/edit/${track.id.slice(4)}`);
              }}
            />
          ) : null}
          <MenuItem
            icon="trash-2"
            label="Eliminar"
            danger
            onPress={() => {
              setMenuOpen(false);
              if (track) confirmDeleteItem(track);
            }}
          />
        </View>
      </Modal>

      <ToastHost bottom={insets.bottom + 24} />
    </Animated.View>
  );
}
