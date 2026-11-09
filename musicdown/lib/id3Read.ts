import { File } from 'expo-file-system';

// Lector mínimo de etiquetas ID3v2 de un MP3: título, artista, álbum y carátula incrustada.
// Solo lee el comienzo del archivo (donde está la etiqueta), no el MP3 completo.

export interface Id3Info {
  title?: string;
  artist?: string;
  album?: string;
  cover?: { bytes: Uint8Array; mime: string };
}

const MAX_TAG_BYTES = 3_000_000; // tope de lectura (las carátulas grandes pueden pasar de 1 MB)

function syncsafe(b: Uint8Array, at: number): number {
  return ((b[at] & 0x7f) << 21) | ((b[at + 1] & 0x7f) << 14) | ((b[at + 2] & 0x7f) << 7) | (b[at + 3] & 0x7f);
}

function be32(b: Uint8Array, at: number): number {
  return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
}

function latin1(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

function utf8(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; ) {
    const c = b[i++];
    if (c < 0x80) s += String.fromCharCode(c);
    else if (c < 0xe0) s += String.fromCharCode(((c & 0x1f) << 6) | (b[i++] & 0x3f));
    else if (c < 0xf0) s += String.fromCharCode(((c & 0x0f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f));
    else {
      const cp = ((c & 0x07) << 18) | ((b[i++] & 0x3f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f);
      const v = cp - 0x10000;
      s += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    }
  }
  return s;
}

function utf16(b: Uint8Array, bigEndianDefault: boolean): string {
  let le = !bigEndianDefault;
  let i = 0;
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) {
    le = true;
    i = 2;
  } else if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    le = false;
    i = 2;
  }
  let s = '';
  for (; i + 1 < b.length; i += 2) s += String.fromCharCode(le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
  return s;
}

function decodeText(encoding: number, b: Uint8Array): string {
  const raw = encoding === 1 ? utf16(b, false) : encoding === 2 ? utf16(b, true) : encoding === 3 ? utf8(b) : latin1(b);
  // Varios valores van separados por NUL (p. ej. varios artistas).
  return raw
    .split('\0')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');
}

/** Posición del terminador de cadena según la codificación (1 byte; 2 para UTF-16). */
function findTerminator(b: Uint8Array, from: number, encoding: number): number {
  if (encoding === 1 || encoding === 2) {
    for (let i = from; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i;
    return -1;
  }
  for (let i = from; i < b.length; i++) if (b[i] === 0) return i;
  return -1;
}

function parsePicture(frame: Uint8Array, v22: boolean): { type: number; bytes: Uint8Array; mime: string } | null {
  if (frame.length < 6) return null;
  const encoding = frame[0];
  let pos = 1;
  let mime: string;
  if (v22) {
    const fmt = latin1(frame.subarray(1, 4)).toUpperCase();
    mime = fmt === 'PNG' ? 'image/png' : 'image/jpeg';
    pos = 4;
  } else {
    const end = findTerminator(frame, 1, 0);
    if (end < 0) return null;
    mime = latin1(frame.subarray(1, end)) || 'image/jpeg';
    pos = end + 1;
  }
  const type = frame[pos++];
  const descEnd = findTerminator(frame, pos, encoding);
  if (descEnd < 0) return null;
  pos = descEnd + (encoding === 1 || encoding === 2 ? 2 : 1);
  if (pos >= frame.length) return null;
  if (mime === 'image/jpg') mime = 'image/jpeg';
  return { type, bytes: frame.slice(pos), mime };
}

/** Analiza la etiqueta ID3v2 a partir de la cabecera (10 bytes) y el cuerpo de la etiqueta. */
function parseTag(head: Uint8Array, body: Uint8Array): Id3Info | null {
  if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return null;
  const major = head[3];
  if (major < 2 || major > 4) return null;
  const flags = head[5];

  let pos = 0;
  if (flags & 0x40 && major >= 3) {
    // Cabecera extendida: se salta.
    pos = major === 4 ? syncsafe(body, 0) : be32(body, 0) + 4;
  }

  const idLen = major === 2 ? 3 : 4;
  const headerLen = major === 2 ? 6 : 10;
  const info: Id3Info = {};
  let bestPicType = 255;

  while (pos + headerLen <= body.length) {
    if (body[pos] === 0) break; // relleno
    const id = latin1(body.subarray(pos, pos + idLen));
    const size =
      major === 2 ? (body[pos + 3] << 16) | (body[pos + 4] << 8) | body[pos + 5] : major === 4 ? syncsafe(body, pos + 4) : be32(body, pos + 4);
    const start = pos + headerLen;
    const end = start + size;
    if (size <= 0 || end > body.length) break;
    const frame = body.subarray(start, end);

    if (id === 'TIT2' || id === 'TT2') info.title ??= decodeText(frame[0], frame.subarray(1)) || undefined;
    else if (id === 'TPE1' || id === 'TP1') info.artist ??= decodeText(frame[0], frame.subarray(1)) || undefined;
    else if (id === 'TALB' || id === 'TAL') info.album ??= decodeText(frame[0], frame.subarray(1)) || undefined;
    else if (id === 'APIC' || id === 'PIC') {
      const pic = parsePicture(frame, major === 2);
      // Prefiere la portada frontal (tipo 3); si no hay, la primera imagen.
      if (pic && pic.bytes.length > 0 && (pic.type === 3 ? 3 : 100) < bestPicType) {
        bestPicType = pic.type === 3 ? 3 : 100;
        info.cover = { bytes: pic.bytes, mime: pic.mime };
      }
    }
    pos = end;
  }
  return info;
}

/** Lectura directa con expo-file-system (solo el inicio del archivo). */
function readViaFileSystem(fileUri: string): Id3Info | null {
  let handle: ReturnType<File['open']> | null = null;
  try {
    handle = new File(fileUri).open();
    const head = handle.readBytes(10);
    if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return null;
    const body = handle.readBytes(Math.min(syncsafe(head, 6), MAX_TAG_BYTES));
    return parseTag(head, body);
  } finally {
    try {
      handle?.close();
    } catch {
      // ya cerrado
    }
  }
}

function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsArrayBuffer(blob);
  });
}

/** Lectura alternativa con fetch + Blob.slice (no pasa por los permisos de rutas de expo-file-system). */
async function readViaFetch(fileUri: string): Promise<Id3Info | null> {
  const blob = await (await fetch(fileUri)).blob();
  const head = await blobToBytes(blob.slice(0, 10));
  if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return null;
  const size = Math.min(syncsafe(head, 6), MAX_TAG_BYTES);
  const body = await blobToBytes(blob.slice(10, 10 + size));
  return parseTag(head, body);
}


/**
 * Lee las etiquetas de un MP3: título, artista, álbum y portada incrustada. Devuelve null si no tiene ID3v2.
 * Primero lee con expo-file-system; si el sistema no lo permite, reintenta con fetch.
 */
export async function readId3(fileUri: string): Promise<Id3Info | null> {
  try {
    return readViaFileSystem(fileUri);
  } catch {
    try {
      return await readViaFetch(fileUri);
    } catch {
      return null;
    }
  }
}
