import { type Agreement, formatDate } from '@bella-vista/shared';

// Meeting agreements as the committee reads them (S-03, S-04, S-05, S-08).

export const AGREEMENT_RESULT_LABELS: Record<Agreement['result'], string> = {
  approved_by_majority: 'Aprobado por mayoría',
  rejected: 'Rechazado',
};

/** "AC-000047 · Aprobado por mayoría · 2026-10-24". */
export const agreementLabel = (agreement: Agreement) =>
  `${agreement.folio} · ${AGREEMENT_RESULT_LABELS[agreement.result]} · ${formatDate(agreement.meetingDate)}`;

/** The votes, when they were recorded: "7 a favor, 2 en contra, 1 abstención". */
export function votesLine(agreement: Agreement): string | null {
  const parts = [
    agreement.votesFor !== null ? `${agreement.votesFor} a favor` : null,
    agreement.votesAgainst !== null ? `${agreement.votesAgainst} en contra` : null,
    agreement.abstentions !== null
      ? `${agreement.abstentions} ${agreement.abstentions === 1 ? 'abstención' : 'abstenciones'}`
      : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

/** S-03: why "Registrar resolución" is disabled. */
export const NEEDS_AGREEMENT = 'Elija el acuerdo de junta.';
export const NEEDS_REJECTION_REASON = 'Escriba el motivo del rechazo.';
