import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { fetchLyrics, type Lyrics } from '../lib/lyrics';
import { getPowerPrefs } from '../lib/powerPrefs';
import { colors, fonts } from '../lib/theme';
import { Icon, LoadingDots } from './ui';

interface Props {
  trackId: string;
  title: string;
  artist: string;
  duration: number;
  position: number;
  height: number;
  onSeek: (seconds: number) => void;
  /**
   * Avisa cuando se puede volver a la línea actual (el usuario desplazó la letra): entrega la función para
   * hacerlo (y hacia dónde queda la línea actual: 'up' si está más arriba de lo que ves, 'down' si más abajo),
   * o null cuando ya se está siguiendo la letra. El botón lo dibuja el padre, por encima del
   * desvanecido de los bordes.
   */
  onJumpChange?: (jump: (() => void) | null, direction: 'up' | 'down') => void;
}

// Colores de lectura del diseño: líneas pasadas suaves, la actual oscura y las siguientes en gris medio.
const PAST = '#7A8791';
const NEXT = '#4A5963';

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}

/** Botón con el tiempo de la línea tocada: ▶ 2:55. */
function TimePill({ time, onPress }: { time: number; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 28, paddingHorizontal: 10, borderRadius: 14, backgroundColor: colors.ink }}
    >
      <Icon name="play" size={12} color={colors.white} />
      <Text style={{ fontFamily: fonts.sansSemi, fontSize: 12, color: colors.white }}>{formatTime(time)}</Text>
    </Pressable>
  );
}

/**
 * Letra de la canción actual (diseño "Letra mejorada").
 * - Sincronizada: tres niveles de lectura (pasadas, actual grande y oscura, siguientes); sigue la línea que suena.
 * - Al desplazarla con el dedo se pausa el seguimiento y aparece el botón "Línea actual" para volver.
 * - Tocar una línea la resalta y muestra un botón con su tiempo (▶ 2:55); al pulsarlo la canción salta ahí.
 * - Sin tiempos: igual, con un tiempo aproximado según el lugar de la línea en la letra.
 */
export function LyricsPanel({ trackId, title, artist, duration, position, height, onSeek, onJumpChange }: Props) {
  const [state, setState] = useState<{ id: string; status: 'loading' | 'done' | 'error'; lyrics: Lyrics | null }>({
    id: trackId,
    status: 'loading',
    lyrics: null,
  });
  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef<number[]>([]);
  const [following, setFollowing] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Posición del desplazamiento y hacia dónde queda la línea actual respecto a lo que se ve.
  const scrollY = useRef(0);
  const [direction, setDirection] = useState<'up' | 'down'>('down');
  const [offlineMsg, setOfflineMsg] = useState(false);
  // Solo los gestos del dedo pausan el seguimiento; los desplazamientos automáticos (programáticos) no.
  const userScrolling = useRef(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearResumeTimer = () => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = null;
  };
  useEffect(() => clearResumeTimer, []);

  // La duración llega un poco después de empezar; se usa solo para afinar la búsqueda, no para repetirla.
  const durationRef = useRef(duration);
  durationRef.current = duration;

  useEffect(() => {
    const controller = new AbortController();
    setState({ id: trackId, status: 'loading', lyrics: null });
    offsets.current = [];
    setSelected(null);
    setFollowing(true);
    // Tope de espera: si la búsqueda no termina en 15 s se muestra el error con "Reintentar".
    const safety = setTimeout(() => {
      controller.abort();
      setState({ id: trackId, status: 'error', lyrics: null });
    }, 15000);
    fetchLyrics(title, artist, durationRef.current, trackId, controller.signal)
      .then((lyrics) => {
        if (!controller.signal.aborted) setState({ id: trackId, status: 'done', lyrics });
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setState({ id: trackId, status: 'error', lyrics: null });
        setOfflineMsg(e instanceof Error && e.message === 'offline');
      })
      .finally(() => clearTimeout(safety));
    return () => {
      clearTimeout(safety);
      controller.abort();
    };
  }, [trackId, title, artist, attempt]);

  const synced = state.id === trackId ? state.lyrics?.synced ?? null : null;

  const activeIndex = useMemo(() => {
    if (!synced) return -1;
    let idx = -1;
    for (let i = 0; i < synced.length; i++) {
      if (synced[i].time <= position + 0.25) idx = i;
      else break;
    }
    return idx;
  }, [synced, position]);

  const scrollToIndex = (index: number) => {
    const y = offsets.current[index];
    if (y !== undefined) scrollRef.current?.scrollTo({ y: Math.max(0, y - height / 2 + 24), animated: true });
  };

  useEffect(() => {
    if (activeIndex >= 0 && following) scrollToIndex(activeIndex);
  }, [activeIndex, height, following]);

  const updateDirection = () => {
    if (activeIndex < 0) return;
    const y = offsets.current[activeIndex];
    if (y === undefined) return;
    // La línea actual se centra en pantalla al seguirla; si queda por encima de ese punto, se vuelve hacia arriba.
    const next = y < scrollY.current + height / 2 - 24 ? 'up' : 'down';
    setDirection((d) => (d === next ? d : next));
  };
  const updateDirectionRef = useRef(updateDirection);
  updateDirectionRef.current = updateDirection;
  // La canción avanza mientras la letra está quieta: la dirección puede cambiar sin que el usuario la toque.
  useEffect(() => {
    updateDirectionRef.current();
  }, [activeIndex, height]);

  const jumpToCurrent = () => {
    clearResumeTimer();
    userScrolling.current = false;
    setFollowing(true);
    if (activeIndex >= 0) scrollToIndex(activeIndex);
  };
  const jumpRef = useRef(jumpToCurrent);
  jumpRef.current = jumpToCurrent;
  const canJump = Boolean(synced) && !following;
  useEffect(() => {
    onJumpChange?.(canJump ? () => jumpRef.current() : null, direction);
    return () => onJumpChange?.(null, direction);
  }, [canJump, direction]);

  const scrollProps = {
    showsVerticalScrollIndicator: false,
    scrollEventThrottle: 80,
    onScroll: (e: { nativeEvent: { contentOffset: { y: number } } }) => {
      scrollY.current = e.nativeEvent.contentOffset.y;
      updateDirectionRef.current();
    },
    onScrollBeginDrag: () => {
      userScrolling.current = true;
      clearResumeTimer();
      setFollowing(false);
    },
    // El seguimiento se reanuda solo, 6 s después de que el usuario deja de tocar la letra.
    onScrollEndDrag: () => {
      clearResumeTimer();
      resumeTimer.current = setTimeout(() => {
        userScrolling.current = false;
        setFollowing(true);
      }, 6000);
    },
  } as const;

  const box = { height, justifyContent: 'center' as const };

  if (state.status === 'loading') {
    return (
      <View style={[box, { alignItems: 'center', gap: 12 }]}>
        <LoadingDots />
        <Text style={{ fontFamily: fonts.serifItalic, fontSize: 14, color: colors.muted }}>Buscando la letra…</Text>
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={[box, { alignItems: 'center', gap: 14, paddingHorizontal: 24 }]}>
        <Text style={{ fontFamily: fonts.serifItalic, fontSize: 16, textAlign: 'center', color: colors.muted }}>
          {offlineMsg || getPowerPrefs().offlineMode
            ? 'Modo sin conexión: esta letra no está guardada en el teléfono.'
            : 'No se pudo cargar la letra. Revisa tu conexión.'}
        </Text>
        {offlineMsg || getPowerPrefs().offlineMode ? null : (
        <Pressable
          onPress={() => setAttempt((n) => n + 1)}
          style={{ height: 40, paddingHorizontal: 18, borderRadius: 20, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ fontFamily: fonts.sansSemi, fontSize: 13, color: colors.white }}>Reintentar</Text>
        </Pressable>
        )}
      </View>
    );
  }

  const lyrics = state.lyrics;
  if (!lyrics || (!lyrics.synced && !lyrics.plain)) {
    return (
      <View style={[box, { alignItems: 'center', paddingHorizontal: 24 }]}>
        <Text style={{ fontFamily: fonts.serifItalic, fontSize: 16, textAlign: 'center', color: colors.muted }}>
          {lyrics?.instrumental ? 'Instrumental' : 'No encontramos la letra de esta canción.'}
        </Text>
      </View>
    );
  }

  /** Fila de una línea: resaltada con su botón de tiempo cuando está seleccionada. */
  const renderRow = (index: number, text: string, time: number, textStyle: object, opts: { disabled?: boolean } = {}) => {
    const isSelected = selected === index;
    return (
      <Pressable
        key={index}
        disabled={opts.disabled}
        onLayout={(e) => {
          offsets.current[index] = e.nativeEvent.layout.y;
        }}
        onPress={() => setSelected(isSelected ? null : index)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: 8,
          margin: -8,
          marginBottom: 12, // 20 px de separación entre líneas (8 de relleno a cada lado)
          borderRadius: 8,
          backgroundColor: isSelected ? 'rgba(20,33,43,0.07)' : 'transparent',
        }}
      >
        {text.trim() ? (
          <Text style={[{ flexShrink: 1 }, textStyle]}>{text}</Text>
        ) : (
          <View style={{ height: 24, justifyContent: 'center' }}>
            <Icon name="music" size={24} color={NEXT} />
          </View>
        )}
        {isSelected && !opts.disabled ? (
          <TimePill
            time={time}
            onPress={() => {
              onSeek(time);
              setSelected(null);
              clearResumeTimer();
              userScrolling.current = false;
              setFollowing(true);
            }}
          />
        ) : null}
      </Pressable>
    );
  };

  if (lyrics.synced) {
    return (
      <View style={{ height }}>
        <ScrollView ref={scrollRef} style={{ height }} {...scrollProps} contentContainerStyle={{ paddingVertical: height / 2 - 24, paddingHorizontal: 8 }}>
          {lyrics.synced.map((line, i) => {
            const active = i === activeIndex;
            const past = i < activeIndex;
            return renderRow(
              i,
              line.text,
              line.time,
              active
                ? { fontFamily: fonts.serifBold, fontSize: 30, lineHeight: 36, color: colors.ink }
                : { fontFamily: fonts.serif, fontSize: 26, lineHeight: 32.5, color: past ? PAST : NEXT }
            );
          })}
        </ScrollView>
      </View>
    );
  }

  // Letra sin tiempos: tiempo aproximado según el lugar de la línea.
  const plainLines = (lyrics.plain ?? '').split(/\r?\n/);
  return (
    <ScrollView style={{ height }} {...scrollProps} contentContainerStyle={{ paddingVertical: 8, paddingHorizontal: 8 }}>
      <Text style={{ marginBottom: 14, fontFamily: fonts.serifItalic, fontSize: 12, color: colors.muted }}>
        Esta letra no trae tiempos: el botón de cada línea salta a un punto aproximado de la canción.
      </Text>
      {plainLines.map((text, i) =>
        renderRow(
          i,
          text,
          (i / Math.max(1, plainLines.length - 1)) * duration,
          { fontFamily: fonts.serif, fontSize: 22, lineHeight: 28, color: colors.ink },
          { disabled: !text.trim() || duration <= 0 }
        )
      )}
    </ScrollView>
  );
}
