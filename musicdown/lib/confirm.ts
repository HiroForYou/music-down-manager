import { useSyncExternalStore } from 'react';

// Diálogo de confirmación con el estilo de la app (reemplaza al Alert nativo en acciones destructivas).
// Se abre con askConfirm() y lo muestra el componente ConfirmHost montado en el layout raíz.

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}

let pending: ConfirmRequest | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function askConfirm(request: ConfirmRequest): void {
  pending = request;
  emit();
}

export function closeConfirm(): void {
  pending = null;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useConfirmRequest(): ConfirmRequest | null {
  return useSyncExternalStore(subscribe, () => pending);
}
