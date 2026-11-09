// Aviso de que un elemento de la biblioteca se eliminó (descarga, archivo externo o like), para que el
// reproductor lo saque de la cola y deje de intentar abrir algo que ya no existe.
// El identificador es el mismo que usa la cola del reproductor: "app:<id>", "ext:<id>" o el id de Spotify.

type Listener = (itemId: string) => void;
const listeners = new Set<Listener>();

export function emitItemRemoved(itemId: string): void {
  listeners.forEach((l) => l(itemId));
}

/** Atajo para las descargas de la app. */
export function emitTrackDeleted(trackId: string): void {
  emitItemRemoved(`app:${trackId}`);
}

export function subscribeTrackDeleted(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
