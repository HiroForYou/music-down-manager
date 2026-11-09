// Tokens del diseño minimalista (ver /templates): papel gris azulado, tinta oscura y un acento terracota.
export const colors = {
  bg: '#E6E9EA',
  ink: '#14212B',
  inkSoft: '#2C3A47',
  muted: '#4A5963',
  faint: '#8B949B',
  line: '#CBD2D6',
  accent: '#A8420E',
  cover: '#62737F',
  white: '#FFFFFF',
};

export const fonts = {
  serif: 'Fraunces_600SemiBold',
  serifMedium: 'Fraunces_500Medium',
  serifBold: 'Fraunces_700Bold',
  serifItalic: 'Fraunces_400Regular_Italic',
  serifItalicMedium: 'Fraunces_500Medium_Italic',
  serifItalicSemi: 'Fraunces_600SemiBold_Italic',
  sans: 'Inter_400Regular',
  sansMedium: 'Inter_500Medium',
  sansSemi: 'Inter_600SemiBold',
};

/** Tonos de las carátulas de relleno, como en los templates. */
const COVER_TONES = ['#A3B1BB', '#85939E', '#B9A58B', '#62737F', '#7C8C97'];
export function coverTone(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return COVER_TONES[Math.abs(h) % COVER_TONES.length];
}
