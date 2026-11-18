import { useEffect, useState } from 'react';
import { AppText, ConfirmSheet } from '../../ui/index.js';
import { useLeaveGuard } from '../accounts/useLeaveGuard.js';

// "Salir con cambios" (3.2 §11.2): while a form has unsaved data, leaving (Atrás, the back
// gesture or the Android back button) asks first. Confirming turns the guard off and leaves.
// Once the form is saved, `leave(go)` turns the guard off and only then navigates (otherwise
// the guard would stop the navigation that follows a save and ask "¿Salir sin enviar?").

export function useDiscardGuard(dirty: boolean) {
  const [released, setReleased] = useState(false);
  const [next, setNext] = useState<(() => void) | null>(null);
  const guard = useLeaveGuard(dirty && !released, () => setReleased(true));

  // Navigate after the render without the guard.
  useEffect(() => {
    if (released && next) {
      setNext(null);
      next();
    }
  }, [released, next]);

  return {
    ...guard,
    /** After saving: leave without asking. */
    leave: (go: () => void) => {
      setReleased(true);
      setNext(() => go);
    },
  };
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
