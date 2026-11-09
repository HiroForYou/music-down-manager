import {
  FlexWidget,
  ImageWidget,
  OverlapWidget,
  SvgWidget,
  TextWidget,
  type ImageWidgetSource,
} from 'react-native-android-widget';

// Widgets de pantalla de inicio "Reproduciendo", inspirados en los de Spotify y Black Player EX pero con la
// paleta de MusicDown (tinta #14212B, papel #E6E9EA, acento terracota #A8420E).
//
//   Fila 4×1        carátula pegada al borde izquierdo + título/artista + controles
//   Medio 4×2       carátula a todo lo alto a la izquierda + datos y controles grandes
//   Portada 4×2/4×4 carátula a pantalla completa con degradado y controles encima
//   Cuadrado 2×2    carátula a pantalla completa con controles abajo
// Fondos de las filas y del medio: sólido, semitraslúcido o transparente.

export interface NowPlayingProps {
  hasTrack: boolean;
  title: string;
  artist: string;
  playing: boolean;
  /** URL https o data:image ya resuelta (null = sin carátula). */
  image: string | null;
}

/** Tamaño real del widget en dp (lo informa el sistema); si falta se usan medidas típicas. */
export interface WidgetSize {
  width: number;
  height: number;
}

export const WIDGET_NAMES = [
  'NowPlaying',
  'NowPlayingSemi',
  'NowPlayingClear',
  'NowPlayingMini',
  'NowPlayingMiniSemi',
  'NowPlayingMiniClear',
  'NowPlayingCover',
  'NowPlayingCoverBig',
  'NowPlayingSquare',
] as const;
export type WidgetName = (typeof WIDGET_NAMES)[number];

const PAPER = '#E6E9EA' as const;
const INK = '#14212B' as const;
const ACCENT = '#A8420E' as const;
const MUTED = '#9FB0BA' as const;
const COVER = '#62737F' as const;

export type Tone = 'solid' | 'semi' | 'clear';

// Fondo y color del texto secundario según el nivel de transparencia.
const TONES = {
  solid: { bg: INK, border: null, secondary: MUTED, shadow: false },
  semi: { bg: 'rgba(20, 33, 43, 0.62)', border: 'rgba(230, 233, 234, 0.14)', secondary: '#C9D3D9', shadow: false },
  clear: { bg: 'rgba(20, 33, 43, 0.35)', border: 'rgba(230, 233, 234, 0.18)', secondary: PAPER, shadow: true },
} as const;

const SHADOW = { textShadowColor: 'rgba(0, 0, 0, 0.6)', textShadowRadius: 5, textShadowOffset: { width: 0, height: 1 } } as const;

function toneStyle(tone: Tone) {
  const t = TONES[tone];
  return {
    secondary: t.secondary,
    // En el fondo transparente el texto lleva una sombra suave para leerse sobre cualquier fondo de pantalla.
    textShadow: t.shadow ? SHADOW : {},
    container: { backgroundColor: t.bg, ...(t.border ? { borderWidth: 1, borderColor: t.border } : {}) },
  };
}

const icon = (inner: string, color: string, size: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${color}" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const PREV_PATH = '<polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5" fill="none"/>';
const NEXT_PATH = '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19" fill="none"/>';
const PLAY_PATH = '<polygon points="7 3 20 12 7 21 7 3"/>';
const PAUSE_PATH = '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>';

function Cover({ image, size, radius = 0 }: { image: string | null; size: number; radius?: number }) {
  if (image) {
    return (
      <ImageWidget
        image={image as ImageWidgetSource}
        imageWidth={size}
        imageHeight={size}
        radius={radius}
        resizeMode="cover"
      />
    );
  }
  return <FlexWidget style={{ width: size, height: size, borderRadius: radius, backgroundColor: COVER }} />;
}

/** Carátula que llena un rectángulo (widgets de portada). */
function CoverFill({ image, width, height }: { image: string | null; width: number; height: number }) {
  if (image) {
    return (
      <ImageWidget image={image as ImageWidgetSource} imageWidth={width} imageHeight={height} resizeMode="cover" />
    );
  }
  return <FlexWidget style={{ width, height, backgroundColor: COVER }} />;
}

// Tamaños de los controles (dp): botón táctil, glifo, círculo de play y glifo de play.
const SIZES = {
  xl: { box: 58, glyph: 34, play: 68, playGlyph: 30 },
  l: { box: 48, glyph: 30, play: 58, playGlyph: 26 },
  m: { box: 40, glyph: 26, play: 54, playGlyph: 24 },
} as const;
type ControlSize = keyof typeof SIZES;

function Control({ action, path, box, glyph }: { action: string; path: string; box: number; glyph: number }) {
  return (
    <FlexWidget clickAction={action} style={{ width: box, height: box, alignItems: 'center', justifyContent: 'center' }}>
      <SvgWidget svg={icon(path, PAPER, glyph)} />
    </FlexWidget>
  );
}

function PlayButton({ playing, size, glyph }: { playing: boolean; size: number; glyph: number }) {
  return (
    <FlexWidget
      clickAction="PLAY_PAUSE"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: ACCENT,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <SvgWidget svg={icon(playing ? PAUSE_PATH : PLAY_PATH, PAPER, glyph)} />
    </FlexWidget>
  );
}

function Controls({ playing, size }: { playing: boolean; size: ControlSize }) {
  const s = SIZES[size];
  return (
    <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Control action="PREV" path={PREV_PATH} box={s.box} glyph={s.glyph} />
      <PlayButton playing={playing} size={s.play} glyph={s.playGlyph} />
      <Control action="NEXT" path={NEXT_PATH} box={s.box} glyph={s.glyph} />
    </FlexWidget>
  );
}

function titles(p: NowPlayingProps) {
  return {
    title: p.hasTrack ? p.title : 'Nada sonando',
    artist: p.hasTrack ? p.artist : 'Abre MusicDown y elige una canción',
  };
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

const shell = {
  height: 'match_parent' as const,
  width: 'match_parent' as const,
  backgroundColor: INK,
  borderRadius: 24,
  overflow: 'hidden' as const,
};

/** Fila 4×1: carátula pegada al borde, datos y controles. */
export function NowPlayingMiniWidget(p: NowPlayingProps & { tone?: Tone; size?: WidgetSize }) {
  const { title, artist } = titles(p);
  const t = toneStyle(p.tone ?? 'solid');
  const coverSize = clamp(p.size?.height ?? 72, 56, 96);
  return (
    <FlexWidget clickAction="OPEN_APP" style={{ ...shell, ...t.container, flexDirection: 'row', alignItems: 'center' }}>
      <Cover image={p.image} size={coverSize} />
      <FlexWidget style={{ flex: 1, flexDirection: 'column', justifyContent: 'center', marginLeft: 12 }}>
        <TextWidget
          text={title}
          maxLines={1}
          truncate="END"
          style={{ fontSize: 15, color: PAPER, fontFamily: 'Fraunces_600SemiBold', ...t.textShadow }}
        />
        <TextWidget text={artist} maxLines={1} truncate="END" style={{ fontSize: 12, color: t.secondary, ...t.textShadow }} />
      </FlexWidget>
      <FlexWidget style={{ marginRight: 6 }}>
        <Controls playing={p.playing} size="l" />
      </FlexWidget>
    </FlexWidget>
  );
}

/** Medio 4×2: carátula a todo lo alto a la izquierda; título/artista arriba y controles grandes abajo. */
export function NowPlayingWidget(p: NowPlayingProps & { tone?: Tone; size?: WidgetSize }) {
  const { title, artist } = titles(p);
  const t = toneStyle(p.tone ?? 'solid');
  const coverSize = clamp(p.size?.height ?? 130, 100, 180);
  return (
    <FlexWidget clickAction="OPEN_APP" style={{ ...shell, ...t.container, flexDirection: 'row', alignItems: 'center' }}>
      <Cover image={p.image} size={coverSize} />
      <FlexWidget
        style={{
          flex: 1,
          height: 'match_parent',
          flexDirection: 'column',
          justifyContent: 'space-between',
          paddingHorizontal: 14,
          paddingVertical: 12,
        }}
      >
        <FlexWidget style={{ flexDirection: 'column' }}>
          <TextWidget
            text="MUSICDOWN"
            style={{ fontSize: 9, letterSpacing: 1.6, color: t.secondary, fontWeight: '600', ...t.textShadow }}
          />
          <TextWidget
            text={title}
            maxLines={1}
            truncate="END"
            style={{ fontSize: 19, color: PAPER, fontFamily: 'Fraunces_600SemiBold', ...t.textShadow }}
          />
          <TextWidget text={artist} maxLines={1} truncate="END" style={{ fontSize: 13, color: t.secondary, ...t.textShadow }} />
        </FlexWidget>
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'center' }}>
          <Controls playing={p.playing} size="xl" />
        </FlexWidget>
      </FlexWidget>
    </FlexWidget>
  );
}

/** Portada 4×2 / 4×4: carátula a pantalla completa, degradado inferior y controles encima. */
export function NowPlayingCoverWidget(p: NowPlayingProps & { size?: WidgetSize; big?: boolean }) {
  const { title, artist } = titles(p);
  const width = Math.round(p.size?.width ?? 320);
  const height = Math.round(p.size?.height ?? (p.big ? 320 : 150));
  return (
    <OverlapWidget clickAction="OPEN_APP" style={{ ...shell, overflow: 'hidden' }}>
      <CoverFill image={p.image} width={width} height={height} />
      <FlexWidget
        style={{
          height: 'match_parent',
          width: 'match_parent',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          padding: 14,
          backgroundGradient: { from: 'rgba(20, 33, 43, 0.96)', to: 'rgba(20, 33, 43, 0.08)', orientation: 'BOTTOM_TOP' },
        }}
      >
        <TextWidget
          text={title}
          maxLines={1}
          truncate="END"
          style={{ fontSize: p.big ? 24 : 20, color: PAPER, fontFamily: 'Fraunces_600SemiBold', ...SHADOW }}
        />
        <TextWidget text={artist} maxLines={1} truncate="END" style={{ fontSize: 13, color: PAPER, ...SHADOW }} />
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'center', marginTop: 6 }}>
          <Controls playing={p.playing} size="xl" />
        </FlexWidget>
      </FlexWidget>
    </OverlapWidget>
  );
}

/** Cuadrado 2×2: carátula a pantalla completa con los controles abajo. */
export function NowPlayingSquareWidget(p: NowPlayingProps & { size?: WidgetSize }) {
  const { title, artist } = titles(p);
  const width = Math.round(p.size?.width ?? 140);
  const height = Math.round(p.size?.height ?? 140);
  return (
    <OverlapWidget clickAction="OPEN_APP" style={{ ...shell, overflow: 'hidden' }}>
      <CoverFill image={p.image} width={width} height={height} />
      <FlexWidget
        style={{
          height: 'match_parent',
          width: 'match_parent',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          alignItems: 'center',
          padding: 8,
          backgroundGradient: { from: 'rgba(20, 33, 43, 0.96)', to: 'rgba(20, 33, 43, 0.05)', orientation: 'BOTTOM_TOP' },
        }}
      >
        <TextWidget
          text={title}
          maxLines={1}
          truncate="END"
          style={{ fontSize: 13, color: PAPER, fontFamily: 'Fraunces_600SemiBold', textAlign: 'center', width: 'match_parent', ...SHADOW }}
        />
        <TextWidget
          text={artist}
          maxLines={1}
          truncate="END"
          style={{ fontSize: 10, color: PAPER, textAlign: 'center', width: 'match_parent', ...SHADOW }}
        />
        <FlexWidget style={{ marginTop: 2 }}>
          <Controls playing={p.playing} size="m" />
        </FlexWidget>
      </FlexWidget>
    </OverlapWidget>
  );
}

export function renderWidgetByName(name: string, props: NowPlayingProps, size?: WidgetSize) {
  switch (name) {
    case 'NowPlayingSemi':
      return <NowPlayingWidget {...props} size={size} tone="semi" />;
    case 'NowPlayingClear':
      return <NowPlayingWidget {...props} size={size} tone="clear" />;
    case 'NowPlayingMini':
      return <NowPlayingMiniWidget {...props} size={size} />;
    case 'NowPlayingMiniSemi':
      return <NowPlayingMiniWidget {...props} size={size} tone="semi" />;
    case 'NowPlayingMiniClear':
      return <NowPlayingMiniWidget {...props} size={size} tone="clear" />;
    case 'NowPlayingCover':
      return <NowPlayingCoverWidget {...props} size={size} />;
    case 'NowPlayingCoverBig':
      return <NowPlayingCoverWidget {...props} size={size} big />;
    case 'NowPlayingSquare':
      return <NowPlayingSquareWidget {...props} size={size} />;
    default:
      return <NowPlayingWidget {...props} size={size} />;
  }
}
