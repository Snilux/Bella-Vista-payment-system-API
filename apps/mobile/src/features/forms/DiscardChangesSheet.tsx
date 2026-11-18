import { useState } from 'react';
import { AppText, ConfirmSheet } from '../../ui/index.js';
import { useLeaveGuard } from '../accounts/useLeaveGuard.js';

// "Salir con cambios" (3.2 §11.2): while a form has unsaved data, leaving (Atrás, the back
// gesture or the Android back button) asks first. Confirming turns the guard off and leaves.

export function useDiscardGuard(dirty: boolean) {
  const [discarded, setDiscarded] = useState(false);
  return useLeaveGuard(dirty && !discarded, () => setDiscarded(true));
}

export function DiscardChangesSheet({ guard }: { guard: ReturnType<typeof useDiscardGuard> }) {
  return (
    <ConfirmSheet
      visible={guard.asking}
      title="¿Salir sin enviar?"
      confirmLabel="Sí, salir"
      danger
      onConfirm={guard.confirm}
      onCancel={guard.cancel}
    >
      <AppText variant="body">Lo que escribió en este formulario se perderá.</AppText>
    </ConfirmSheet>
  );
}
