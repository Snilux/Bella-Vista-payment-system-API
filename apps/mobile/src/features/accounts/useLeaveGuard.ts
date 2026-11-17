import { useNavigation, usePreventRemove } from 'expo-router';
import { useEffect, useState } from 'react';

// While a temporary password is on screen, leaving (Atrás, the back gesture, the Android back
// button or "Listo") first asks "¿Ya la anotó?": once the screen closes it cannot be seen again
// (3.2 §10.8, A-02). Confirming calls `release` (the screen forgets the password, which turns
// the guard off) and only then leaves.

export function useLeaveGuard(active: boolean, release: () => void) {
  const navigation = useNavigation();
  const [asking, setAsking] = useState<(() => void) | null>(null);
  const [leaving, setLeaving] = useState<(() => void) | null>(null);

  usePreventRemove(active, ({ data }) => {
    setAsking(() => () => navigation.dispatch(data.action));
  });

  // Leave only after the screen re-rendered without the password (the guard is off by then).
  useEffect(() => {
    if (!active && leaving) {
      setLeaving(null);
      leaving();
    }
  }, [active, leaving]);

  return {
    /** The question is on screen. */
    asking: asking !== null,
    /** "Listo": ask before running `leave` (or run it at once when nothing is guarded). */
    ask: (leave: () => void) => {
      if (active) setAsking(() => leave);
      else leave();
    },
    confirm: () => {
      setLeaving(() => asking);
      setAsking(null);
      release();
    },
    cancel: () => setAsking(null),
  };
}
