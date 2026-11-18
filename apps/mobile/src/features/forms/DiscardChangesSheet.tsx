import { useEffect, useState } from 'react';
import { AppText, ConfirmSheet } from '../../ui/index.js';
import { useLeaveGuard } from '../accounts/useLeaveGuard.js';

// "Salir con cambios" (3.2 §11.2): while a form has unsaved data, leaving (Atrás, the back
// gesture or the Android back button) asks first. Confirming turns the guard off and leaves.
// Once the form is saved, `leave(go)` turns the guard off and only then navigates (otherwise
// the guard would stop the navigation that follows a save and ask "¿Salir sin enviar?").
//
// `unknown`: the form sent something and no answer arrived ("No sabemos si se registró"). It
// may already be registered, so leaving asks with a different warning (M9): going out forgets
// the key of that attempt, and registering it again without checking would duplicate it.

export type DiscardGuardOptions = {
  /** An attempt without answer: the guard is on even if the form looks empty. */
  unknown?: boolean;
};

export function useDiscardGuard(dirty: boolean, { unknown = false }: DiscardGuardOptions = {}) {
  const [released, setReleased] = useState(false);
  const [next, setNext] = useState<(() => void) | null>(null);
  const guard = useLeaveGuard((dirty || unknown) && !released, () => setReleased(true));

  // Navigate after the render without the guard.
  useEffect(() => {
    if (released && next) {
      setNext(null);
      next();
    }
  }, [released, next]);

  return {
    ...guard,
    unknown,
    /** After saving: leave without asking. */
    leave: (go: () => void) => {
      setReleased(true);
      setNext(() => go);
    },
  };
}

export const UNKNOWN_LEAVE_TITLE = '¿Salir sin saber si se registró?';
export const UNKNOWN_LEAVE_MESSAGE =
  'Puede que ya se haya registrado. Antes de registrarlo otra vez, revise que no aparezca; si lo repite sin revisar, quedará duplicado.';

export function DiscardChangesSheet({ guard }: { guard: ReturnType<typeof useDiscardGuard> }) {
  return (
    <ConfirmSheet
      visible={guard.asking}
      title={guard.unknown ? UNKNOWN_LEAVE_TITLE : '¿Salir sin enviar?'}
      confirmLabel="Sí, salir"
      danger
      onConfirm={guard.confirm}
      onCancel={guard.cancel}
    >
      <AppText variant="body">
        {guard.unknown ? UNKNOWN_LEAVE_MESSAGE : 'Lo que escribió en este formulario se perderá.'}
      </AppText>
    </ConfirmSheet>
  );
}
