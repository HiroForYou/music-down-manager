import { useSyncExternalStore } from 'react';

// Aviso breve ("Agregada a tus me gusta") con acción opcional ("Deshacer"). Cualquier pantalla lo dispara con
// showToast() y lo muestra el componente ToastHost.

export interface ToastOptions {
  /** Texto del botón de acción (p. ej. "Deshacer"). */
  actionLabel?: string;
  onAction?: () => void;
  /** Duración en ms; por defecto 2,2 s (4 s si trae acción). */
  durationMs?: number;
}

export interface ToastMessage {
  id: number;
  message: string;
  icon: string;
  actionLabel?: string;
  onAction?: () => void;
}

let current: ToastMessage | null = null;
let counter = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function showToast(message: string, icon: string = 'check', options: ToastOptions = {}): void {
  if (timer) clearTimeout(timer);
  const hasAction = Boolean(options.actionLabel && options.onAction);
  current = {
    id: ++counter,
    message,
    icon,
    actionLabel: hasAction ? options.actionLabel : undefined,
    onAction: hasAction ? options.onAction : undefined,
  };
  emit();
  timer = setTimeout(() => dismissToast(), options.durationMs ?? (hasAction ? 4000 : 2200));
}

export function dismissToast(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  current = null;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useToast(): ToastMessage | null {
  return useSyncExternalStore(subscribe, () => current);
}
