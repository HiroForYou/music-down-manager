import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated } from 'react-native';

import { dominantColor, hslToRgb, peekColor, rgbToHsl, type RGB } from './coverColor';
import { useThemePrefs, type TintIntensity } from './themePrefs';

const PAPER: RGB = [0xe6, 0xe9, 0xea];

const css = ([r, g, b]: RGB) => `rgb(${r}, ${g}, ${b})`;

/**
 * Fondo pastel con el tono de la carátula. Siempre es claro (luminosidad alta) sin importar qué tan oscura sea la
 * portada, así el texto oscuro del diseño mantiene el contraste.
 */
function pastel(color: RGB, intensity: TintIntensity): RGB {
  const [h, s] = rgbToHsl(color);
  const cfg = {
    soft: { sat: 0.5, min: 0.1, max: 0.3, light: 0.92 },
    medium: { sat: 0.8, min: 0.16, max: 0.5, light: 0.88 },
    strong: { sat: 1, min: 0.24, max: 0.65, light: 0.83 },
  }[intensity];
  // Portadas casi grises quedan casi grises (no se inventa un color).
  const saturation = s < 0.12 ? s * 0.6 : Math.min(cfg.max, Math.max(cfg.min, s * cfg.sat));
  return hslToRgb(h, saturation, cfg.light);
}

function darken([r, g, b]: RGB, amount: number): RGB {
  return [Math.round(r * (1 - amount)), Math.round(g * (1 - amount)), Math.round(b * (1 - amount))];
}

export interface CoverBackground {
  /** Para el contenedor principal: cambia con un fundido suave al cambiar de canción. */
  animated: Animated.AnimatedInterpolation<string>;
  /** Color final (para barras, hojas y bordes que no se animan). */
  target: string;
  /** Color final un poco más oscuro (estado "pulsado" de las barras). */
  pressed: string;
  /** Color de líneas y pistas (la línea del tiempo): el fondo un poco más oscuro. */
  line: string;
  animatedLine: Animated.AnimatedInterpolation<string>;
  rgb: RGB;
}

/** Fondo de la pantalla Reproduciendo según la portada (o el papel gris de siempre si está desactivado). */
export function useCoverBackground(image: string | null | undefined): CoverBackground {
  const { coverBackground, intensity } = useThemePrefs();
  // Si el color ya se calculó (precarga) se usa en el mismo render, sin esperar.
  const [resolved, setResolved] = useState<{ image: string; color: RGB | null } | null>(null);
  const cached = coverBackground && image ? peekColor(image) : undefined;
  const dominant = cached !== undefined ? cached : resolved && resolved.image === image ? resolved.color : null;

  useEffect(() => {
    let alive = true;
    if (!coverBackground || !image || peekColor(image) !== undefined) return;
    dominantColor(image).then((c) => {
      if (alive) setResolved({ image, color: c });
    });
    return () => {
      alive = false;
    };
  }, [image, coverBackground]);

  const rgb = useMemo<RGB>(() => (coverBackground && dominant ? pastel(dominant, intensity) : PAPER), [coverBackground, dominant, intensity]);
  const target = css(rgb);

  // Fundido entre el color anterior y el nuevo. Los pares se actualizan en el mismo render del cambio (sin un
  // render extra) y el fundido arranca antes de pintar, para que no haya retraso visible.
  const line = css(darken(rgb, 0.11));
  const anim = useRef(new Animated.Value(1)).current;
  const changed = useRef(false);
  const pair = useRef({ from: target, to: target, lineFrom: line, lineTo: line });
  const last = useRef({ target, line });
  if (last.current.target !== target) {
    pair.current = { from: last.current.target, to: target, lineFrom: last.current.line, lineTo: line };
    last.current = { target, line };
    changed.current = true;
  }
  useLayoutEffect(() => {
    if (!changed.current) return;
    changed.current = false;
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 300, useNativeDriver: false }).start();
  });

  const animated = anim.interpolate({ inputRange: [0, 1], outputRange: [pair.current.from, pair.current.to] });
  const animatedLine = anim.interpolate({ inputRange: [0, 1], outputRange: [pair.current.lineFrom, pair.current.lineTo] });
  return { animated, target, pressed: css(darken(rgb, 0.04)), line, animatedLine, rgb };
}
