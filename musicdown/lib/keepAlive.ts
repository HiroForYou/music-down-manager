// Mantiene viva la app durante tareas largas (descarga de muchas canciones). Con la pantalla apagada Android
// suspende las apps que no tienen un servicio en primer plano; el reproductor usa un audio silencioso con
// notificación multimedia ("Descargando…") para mantener la app activa y con red.

export interface KeepAliveInfo {
  active: boolean;
  title: string;
  detail: string;
}

type Listener = (info: KeepAliveInfo) => void;
const listeners = new Set<Listener>();

export function setKeepAlive(info: KeepAliveInfo): void {
  listeners.forEach((l) => l(info));
}

export function subscribeKeepAlive(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
