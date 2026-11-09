import { Feather, Ionicons } from '@expo/vector-icons';
import { memo, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Animated, Easing, Image, Pressable, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

import { useAppActive } from '../lib/appActive';
import { usePowerPrefs } from '../lib/powerPrefs';
import { coverTone, colors, fonts } from '../lib/theme';

export type IconName = ComponentProps<typeof Feather>['name'];

export function Icon({ name, size = 20, color = colors.ink }: { name: IconName; size?: number; color?: string }) {
  return <Feather name={name} size={size} color={color} />;
}

/** Título grande serif de cada pantalla. */
export function ScreenTitle({ children, subtitle, right }: { children: string; subtitle?: string; right?: ReactNode }) {
  return (
    <View style={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 12 }}>
      <Text style={{ fontFamily: fonts.serifBold, fontSize: 48, lineHeight: 56, color: colors.ink, letterSpacing: -1 }}>
        {children}
      </Text>
      {subtitle || right ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
          {subtitle ? (
            <Text style={{ flex: 1, fontFamily: fonts.serifItalic, fontSize: 14, color: colors.muted }}>{subtitle}</Text>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          {right}
        </View>
      ) : null}
    </View>
  );
}

/** Pestañas de texto con subrayado (Mis descargas / Todas, Enlace / YouTube). */
export function TextTabs<T extends string>({
  tabs,
  value,
  onChange,
  right,
}: {
  tabs: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
  right?: ReactNode;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, gap: 18 }}>
      {tabs.map((tab) => {
        const active = tab.key === value;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            style={{ paddingVertical: 6, borderBottomWidth: 2, borderBottomColor: active ? colors.ink : 'transparent' }}
          >
            <Text style={{ fontFamily: active ? fonts.sansSemi : fonts.sansMedium, fontSize: 14, color: active ? colors.ink : colors.muted }}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
      <View style={{ flex: 1 }} />
      {right}
    </View>
  );
}

export function SearchField({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginHorizontal: 24,
        borderBottomWidth: 1,
        borderBottomColor: colors.ink,
      }}
    >
      <Icon name="search" size={18} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={{ flex: 1, paddingVertical: 12, fontFamily: fonts.sans, fontSize: 15, color: colors.ink }}
      />
      {value ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={10}>
          <Icon name="x" size={16} color={colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Campo con etiqueta pequeña arriba y línea inferior. */
export function Field({
  label,
  size = 'md',
  ...props
}: TextInputProps & { label: string; size?: 'md' | 'lg' }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 2 }}>
      <Text style={{ fontFamily: fonts.sans, fontSize: size === 'lg' ? 14 : 12, color: colors.muted }}>{label}</Text>
      <TextInput
        {...props}
        onFocus={(e) => {
          setFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          props.onBlur?.(e);
        }}
        placeholderTextColor={colors.faint}
        style={[
          {
            paddingVertical: size === 'lg' ? 14 : 10,
            fontFamily: fonts.sans,
            fontSize: size === 'lg' ? 18 : 16,
            color: colors.ink,
            borderBottomWidth: focused ? 2 : 1,
            borderBottomColor: focused ? colors.accent : colors.ink,
          },
          props.style,
        ]}
      />
    </View>
  );
}

export function SectionLabel({ children, style }: { children: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ paddingHorizontal: 24 }, style]}>
      <Text style={{ fontFamily: fonts.sansMedium, fontSize: 11, letterSpacing: 1.4, color: colors.muted }}>
        {children.toUpperCase()}
      </Text>
    </View>
  );
}

type ButtonVariant = 'solid' | 'outline';
export function Button({
  label,
  onPress,
  variant = 'solid',
  disabled,
  tone = colors.ink,
  style,
}: {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  tone?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const solid = variant === 'solid';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        {
          height: 54,
          borderRadius: 4,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: solid ? tone : 'transparent',
          borderWidth: variant === 'outline' ? 1 : 0,
          borderColor: colors.ink,
          opacity: disabled && solid && tone === colors.ink ? 0.55 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      <Text style={{ fontFamily: fonts.sansSemi, fontSize: 15, color: solid ? colors.white : colors.ink }}>{label}</Text>
    </Pressable>
  );
}

/** Carátula; si no hay imagen, un bloque de color liso como en los templates. */
export function Cover({
  uri,
  size,
  height,
  seed,
  radius = 3,
}: {
  uri?: string | null;
  size: number;
  /** Alto; si no se indica, la carátula es cuadrada. */
  height?: number;
  seed: string;
  radius?: number;
}) {
  const [failed, setFailed] = useState(false);
  // Si cambia la imagen (p. ej. llega la portada leída del archivo), se vuelve a intentar cargarla.
  useEffect(() => {
    setFailed(false);
  }, [uri]);
  const tone = coverTone(seed);
  if (uri && !failed) {
    return (
      <Image
        source={{ uri }}
        onError={() => setFailed(true)}
        style={{ width: size, height: height ?? size, borderRadius: radius, backgroundColor: tone }}
      />
    );
  }
  return <View style={{ width: size, height: height ?? size, borderRadius: radius, backgroundColor: tone }} />;
}

export type ActiveState = 'loading' | 'playing' | 'paused';

/** Tres barritas tipo ecualizador: se mueven con suavidad (y a ratos descansan) mientras suena. */
export function EqBars({ playing, color = colors.accent }: { playing: boolean; color?: string }) {
  const MAX = 16;
  const heights = useRef([new Animated.Value(8), new Animated.Value(14), new Animated.Value(10)]).current;
  // Con ahorro de energía o con la app fuera de pantalla, las barras quedan quietas.
  const active = useAppActive();
  const { saveEnergy } = usePowerPrefs();
  const animate = playing && active && !saveEnergy;

  useEffect(() => {
    if (!animate) {
      // En pausa quedan quietas, a media altura.
      heights.forEach((h, i) => {
        h.stopAnimation();
        Animated.timing(h, { toValue: [6, 12, 8][i], duration: 200, useNativeDriver: false }).start();
      });
      return;
    }
    let stopped = false;
    const run = (h: Animated.Value) => {
      if (stopped) return;
      const target = 4 + Math.random() * (MAX - 4);
      Animated.sequence([
        Animated.timing(h, {
          toValue: target,
          duration: 380 + Math.random() * 420,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
        // Pausa breve de vez en cuando, para que el movimiento sea suave y no frenético.
        Animated.delay(Math.random() < 0.35 ? 250 + Math.random() * 500 : 0),
      ]).start(({ finished }) => {
        if (finished) run(h);
      });
    };
    heights.forEach(run);
    return () => {
      stopped = true;
      heights.forEach((h) => h.stopAnimation());
    };
  }, [animate, heights]);

  return (
    <View style={{ width: 18, height: MAX, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
      {heights.map((h, i) => (
        <Animated.View key={i} style={{ width: 3, height: h, borderRadius: 1.5, backgroundColor: color }} />
      ))}
    </View>
  );
}

/** Tres puntos que laten en onda: indica que la canción aún se está cargando. */
export function LoadingDots({ color = colors.accent, size = 5 }: { color?: string; size?: number }) {
  const dots = useRef([new Animated.Value(0.25), new Animated.Value(0.25), new Animated.Value(0.25)]).current;
  const active = useAppActive();
  const { saveEnergy } = usePowerPrefs();
  const animate = active && !saveEnergy;

  useEffect(() => {
    if (!animate) {
      dots.forEach((d) => d.setValue(0.7));
      return;
    }
    const loops = dots.map((d, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(d, { toValue: 1, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(d, { toValue: 0.25, duration: 320, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          Animated.delay((2 - i) * 160),
        ])
      )
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [dots, animate]);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.7, height: 16 }}>
      {dots.map((d, i) => (
        <Animated.View
          key={i}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color,
            opacity: d,
            transform: [{ scale: d.interpolate({ inputRange: [0.25, 1], outputRange: [0.8, 1.15] }) }],
          }}
        />
      ))}
    </View>
  );
}

/** Fila numerada de la lista (Música / Spotify). */
function TrackRowBase({
  index,
  title,
  subtitle,
  coverUri,
  seed,
  active,
  activeState,
  selected,
  selecting,
  trailing,
  rowKey,
  onPress,
  onLongPress,
  onPressRow,
  onLongPressRow,
}: {
  index: number;
  title: string;
  subtitle: string;
  coverUri?: string | null;
  seed: string;
  active?: boolean;
  activeState?: ActiveState;
  selected?: boolean;
  selecting?: boolean;
  /** Elemento extra al final de la fila (p. ej. estado de descarga). */
  trailing?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Alternativa estable a onPress/onLongPress para listas largas: la fila puede memoizarse. */
  rowKey?: string;
  onPressRow?: (rowKey: string, index: number) => void;
  onLongPressRow?: (rowKey: string, index: number) => void;
}) {
  return (
    // El resaltado (selección / pulsación) ocupa todo el ancho; el contenido y la línea divisoria van con margen.
    <Pressable
      onPress={onPress ?? (onPressRow && rowKey !== undefined ? () => onPressRow(rowKey, index) : undefined)}
      onLongPress={onLongPress ?? (onLongPressRow && rowKey !== undefined ? () => onLongPressRow(rowKey, index) : undefined)}
      style={({ pressed }) => ({
        height: 69,
        backgroundColor: selected ? 'rgba(20,33,43,0.08)' : pressed ? 'rgba(20,33,43,0.04)' : 'transparent',
      })}
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
      {/* Ancho fijo y una sola línea: con 2-4 cifras el número nunca se parte en vertical. */}
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
        style={{ width: 34, flexShrink: 0, fontFamily: fonts.serifItalicSemi, fontSize: 18, color: colors.accent }}
      >
        {index + 1}
      </Text>
      <View style={{ width: 44, height: 44 }}>
        <Cover uri={coverUri} size={44} seed={seed} />
        {active && !selecting ? (
          // El indicador de reproducción va sobre la carátula (como en los reproductores habituales).
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              borderRadius: 3,
              backgroundColor: 'rgba(20,33,43,0.62)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {activeState === 'loading' ? (
              <LoadingDots color={colors.white} size={4} />
            ) : (
              <EqBars playing={activeState === 'playing'} color={colors.white} />
            )}
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.serif, fontSize: 17, color: active ? colors.accent : colors.ink }}>
          {title}
        </Text>
        <Text numberOfLines={1} style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.muted }}>
          {subtitle}
        </Text>
      </View>
      {selecting ? (
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 3,
            borderWidth: 1.5,
            borderColor: selected ? colors.ink : colors.muted,
            backgroundColor: selected ? colors.ink : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {selected ? <Icon name="check" size={14} color={colors.white} /> : null}
        </View>
      ) : null}
      {trailing}
      </View>
    </Pressable>
  );
}

/** Fila de lista memoizada: solo se vuelve a dibujar si cambian sus propiedades. */
export const TrackRow = memo(TrackRowBase);

/** Aviso oscuro inferior (reemplaza a los textos de éxito/error). */
export function Toast({ message, icon = 'check' }: { message: string | null; icon?: IconName }) {
  if (!message) return null;
  return (
    <View
      pointerEvents="none"
      style={{
        marginHorizontal: 24,
        minHeight: 54,
        borderRadius: 4,
        backgroundColor: colors.ink,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingHorizontal: 20,
        paddingVertical: 12,
      }}
    >
      <Icon name={icon} size={18} color={colors.white} />
      <Text numberOfLines={2} style={{ flex: 1, fontFamily: fonts.sansSemi, fontSize: 14, color: colors.white }}>
        {message}
      </Text>
    </View>
  );
}

/** Botón/estado de descarga de una fila: pendiente (contorno), descargando (puntos) o descargada (check). */
export function DownloadBadge({
  state,
  onPress,
  disabled,
}: {
  state: 'pending' | 'downloading' | 'done';
  onPress?: () => void;
  disabled?: boolean;
}) {
  const box = { width: 32, height: 32, borderRadius: 16, alignItems: 'center' as const, justifyContent: 'center' as const };
  if (state === 'done') {
    return (
      <View style={[box, { backgroundColor: colors.accent }]}>
        <Icon name="check" size={16} color={colors.white} />
      </View>
    );
  }
  if (state === 'downloading') {
    return (
      <View style={[box, { borderWidth: 1.5, borderColor: colors.accent }]}>
        <LoadingDots size={3} />
      </View>
    );
  }
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={8} style={[box, { borderWidth: 1.5, borderColor: disabled ? colors.line : colors.ink }]}>
      <Icon name="arrow-down" size={16} color={disabled ? colors.faint : colors.ink} />
    </Pressable>
  );
}


/** Corazón de "Me Gustan": contorno cuando no está marcada y relleno terracota cuando sí. */
export function HeartIcon({ filled, size = 22, color }: { filled: boolean; size?: number; color?: string }) {
  return <Ionicons name={filled ? 'heart' : 'heart-outline'} size={size} color={color ?? (filled ? colors.accent : colors.ink)} />;
}
