import { ReasonSheet } from '../forms/ReasonSheet.js';

// R-03 "Rechazar": the reason is mandatory (docs/api.md; 3.2 §12). While it is empty the button
// stays disabled and says why, so the president never sends a rejection without it.

export const REJECT_NEEDS_REASON = 'Escriba el motivo para poder rechazar.';

export type RejectSheetProps = {
  visible: boolean;
  /** What is being rejected (the request's description). */
  summary: string;
  loading: boolean;
  serverError: string | null;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
};

export function RejectSheet(props: RejectSheetProps) {
  return (
    <ReasonSheet
      {...props}
      title="Rechazar solicitud"
      reasonLabel="Motivo del rechazo"
      confirmLabel="Rechazar"
      needsReason={REJECT_NEEDS_REASON}
      help="Quien la solicitó leerá este motivo."
      footnote="El rechazo queda en la bitácora con su motivo."
    />
  );
}
