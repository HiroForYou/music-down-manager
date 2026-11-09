import { File } from 'expo-file-system';
import { decode as decodeJpeg } from 'jpeg-js';
import UPNG from 'upng-js';

import { getPowerPrefs } from './powerPrefs';

// Color dominante de una carátula (para teñir el fondo de la pantalla Reproduciendo).
// Se decodifica la imagen en JavaScript (JPEG o PNG), se toman unas 4000 muestras y se elige el tono más
// "vivo" (ignorando blancos, negros y grises), no el promedio, que suele salir apagado y marrón.

export type RGB = [number, number, number];

const cache = new Map<string, RGB | null>();
const inflight = new Map<string, Promise<RGB | null>>();
const MAX_BYTES = 800_000; // un JPEG enorme bloquearía el hilo de JavaScript al decodificarlo

/** Las portadas de Spotify tienen variantes por tamaño; para el color basta la de 64 px. */
function smallVariant(url: string): string {
  return url.replace('ab67616d0000b273', 'ab67616d00004851').replace('ab67616d00001e02', 'ab67616d00004851');
}

async function loadBytes(uri: string): Promise<Uint8Array | null> {
  if (uri.startsWith('file:') || uri.startsWith('/')) return new File(uri).bytes();
  if (getPowerPrefs().offlineMode) return null; // sin conexión no se descargan imágenes
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(smallVariant(uri), { signal: controller.signal });
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function decodeToRgba(bytes: Uint8Array): { data: Uint8Array; width: number; height: number } | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const image = decodeJpeg(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 12, maxMemoryUsageInMB: 96 });
    return { data: image.data as unknown as Uint8Array, width: image.width, height: image.height };
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const png = UPNG.decode(copy);
    return { data: new Uint8Array(UPNG.toRGBA8(png)[0]), width: png.width, height: png.height };
  }
  return null;
}

export function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === rn ? ((gn - bn) / d) % 6 : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  h = (h * 60 + 360) % 360;
  return [h, s, l];
}

export function hslToRgb(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function dominant(data: Uint8Array, width: number, height: number): RGB {
  const total = width * height;
  const step = Math.max(1, Math.floor(total / 4000));
  const BINS = 24;
  const weight = new Float64Array(BINS);
  const rs = new Float64Array(BINS), gs = new Float64Array(BINS), bs = new Float64Array(BINS);
  let ar = 0, ag = 0, ab = 0, an = 0;

  for (let i = 0; i < total; i += step) {
    const p = i * 4;
    if (data[p + 3] < 200) continue;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    ar += r; ag += g; ab += b; an++;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const v = max / 255;
    const s = max === 0 ? 0 : (max - min) / max;
    if (v < 0.18 || s < 0.15) continue; // negro, blanco o gris: no aportan color
    const [h] = rgbToHsl([r, g, b]);
    const bin = Math.min(BINS - 1, Math.floor((h / 360) * BINS));
    const w = s * s * (0.4 + v);
    weight[bin] += w;
    rs[bin] += r * w; gs[bin] += g * w; bs[bin] += b * w;
  }

  let best = -1;
  for (let k = 0; k < BINS; k++) if (best < 0 || weight[k] > weight[best]) best = k;
  if (best >= 0 && weight[best] > 0) {
    return [Math.round(rs[best] / weight[best]), Math.round(gs[best] / weight[best]), Math.round(bs[best] / weight[best])];
  }
  // Portada en blanco y negro o muy apagada: el promedio (un gris).
  return an > 0 ? [Math.round(ar / an), Math.round(ag / an), Math.round(ab / an)] : [230, 233, 234];
}

/** Color dominante de la carátula, o null si no se puede leer. El resultado se guarda en memoria. */
export function dominantColor(imageUri: string): Promise<RGB | null> {
  if (cache.has(imageUri)) return Promise.resolve(cache.get(imageUri) ?? null);
  let job = inflight.get(imageUri);
  if (!job) {
    job = compute(imageUri).finally(() => inflight.delete(imageUri));
    inflight.set(imageUri, job);
  }
  return job;
}

/** Color ya calculado (sin esperar), o undefined si todavía no se conoce. */
export function peekColor(imageUri: string | null | undefined): RGB | null | undefined {
  return imageUri ? cache.get(imageUri) : undefined;
}

/** Calcula por adelantado los colores de las canciones cercanas, para que el cambio sea instantáneo. */
export function prefetchColors(images: (string | null | undefined)[]): void {
  for (const image of images) if (image && !cache.has(image)) void dominantColor(image);
}

async function compute(imageUri: string): Promise<RGB | null> {
  let result: RGB | null = null;
  try {
    const bytes = await loadBytes(imageUri);
    if (bytes && bytes.length > 0 && bytes.length <= MAX_BYTES) {
      await new Promise((resolve) => setTimeout(resolve, 0)); // deja respirar a la interfaz antes de decodificar
      const image = decodeToRgba(bytes);
      if (image) result = dominant(image.data, image.width, image.height);
    }
  } catch {
    result = null;
  }
  if (cache.size > 300) cache.clear();
  cache.set(imageUri, result);
  return result;
}
