// R-03 · Detalle de autorización
import { type Approval, formatDateTime } from '@bella-vista/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { describeError } from '../../../../src/api/error-messages.js';
import { isApiError } from '../../../../src/api/errors.js';
import { useApproval, useResolveApproval } from '../../../../src/api/useApprovals.js';
import { ApprovalSubjectDetail } from '../../../../src/features/approvals/ApprovalSubjectDetail.js';
import {
  APPROVAL_STATUS_TAGS,
  APPROVAL_TYPE_TEXTS,
} from '../../../../src/features/approvals/approval-types.js';
import { RejectSheet } from '../../../../src/features/approvals/RejectSheet.js';
import { ROLE_LABELS } from '../../../../src/session/role-labels.js';
import {
  AppText,
  Button,
  ConfirmSheet,
  colors,
  DataRow,
  Header,
  Notice,
  ScreenLayout,
  ScreenState,
  StatusTag,
  SummaryCard,
  screenStatusOf,
} from '../../../../src/ui/index.js';

// Who requests it, when and why, and what is authorized (2.6 R-03; 3.2 §10.8). The description
// written by the module that owns the type carries the data (block, who leaves and who comes in,
// start date…); since M6 the approval also points to its record (subject), so the screen shows
// the real payment or rate and opens it (G-05, G-04). It adds what authorizing does. Authorizing asks for confirmation; rejecting needs a
// reason. Once resolved, the inbox and the tab counter are already updated.

type Sheet = 'approve' | 'reject' | null;

export default function ApprovalDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const approvalId = Number(id);
  const query = useApproval(approvalId);
  const resolve = useResolveApproval(approvalId);
  const [sheet, setSheet] = useState<Sheet>(null);

  // The answer of the resolution wins over the lists while they reload.
  const approval: Approval | null = resolve.data?.approval ?? query.data ?? null;
  const status = screenStatusOf(query);

  if (!approval) {
    return (
      <ScreenLayout>
        <Header title="Detalle de autorización" onBack={() => router.back()} />
        {status === 'ready' ? (
          <Notice
            title="No existe esa solicitud."
            detail="Vuelva a la bandeja de autorizaciones."
          />
        ) : (
          <ScreenState status={status} error={query.error} onRetry={() => void query.refetch()} />
        )}
      </ScreenLayout>
    );
  }

  const text = APPROVAL_TYPE_TEXTS[approval.type];
  const pending = approval.status === 'pending';
  const summary = approval.description ?? text.label;
  // Someone else resolved it first: the message replaces the actions until the list reloads.
  const alreadyResolved =
    resolve.isError &&
    isApiError(resolve.error) &&
    resolve.error.code === 'APPROVAL_ALREADY_RESOLVED';
  const serverError = resolve.isError ? describeError(resolve.error).message : null;

  const send = (result: 'approved' | 'rejected', reason?: string) =>
    resolve.mutate(
      { result, reason },
      {
        onSuccess: () => setSheet(null),
        // Resolved by someone else: close the sheet so the screen says so.
        onError: (error) => {
          if (isApiError(error) && error.code === 'APPROVAL_ALREADY_RESOLVED') setSheet(null);
        },
      },
    );
  const open = (next: Exclude<Sheet, null>) => {
    resolve.reset();
    setSheet(next);
  };

  const footer =
    pending && !alreadyResolved ? (
      <>
        <Button label="Autorizar" onPress={() => open('approve')} />
        <Button label="Rechazar" variant="secondary" onPress={() => open('reject')} />
      </>
    ) : resolve.isSuccess || alreadyResolved ? (
      <Button label="Volver a autorizaciones" onPress={() => router.back()} />
    ) : null;

  return (
    <ScreenLayout {...(footer ? { footer } : {})}>
      <Header title={text.label} onBack={() => router.back()} />
      <StatusTag {...APPROVAL_STATUS_TAGS[approval.status]} />

      {resolve.isSuccess ? (
        <Notice
          icon="success"
          title={approval.status === 'approved' ? 'Solicitud autorizada.' : 'Solicitud rechazada.'}
          detail="La bandeja de autorizaciones ya está actualizada."
        />
      ) : null}
      {alreadyResolved && serverError ? <Notice icon="info" title={serverError} /> : null}

      <SummaryCard tone="plain">
        <DataRow
          label="Solicita"
          value={`${approval.requestedBy.fullName} · ${ROLE_LABELS[approval.requestedBy.role]}`}
        />
        <DataRow label="Fecha" value={formatDateTime(approval.requestedAt)} />
        <DataRow label="Motivo" value={approval.reason} />
      </SummaryCard>

      <SummaryCard>
        <AppText variant="label" color={colors.textSecondary}>
          Qué se autoriza
        </AppText>
        <AppText variant="bodyStrong">{summary}</AppText>
      </SummaryCard>
      <ApprovalSubjectDetail subject={approval.subject} />

      {approval.status !== 'pending' ? (
        <SummaryCard tone="plain">
          {approval.resolvedBy ? (
            <DataRow
              label={approval.status === 'approved' ? 'Autorizó' : 'Rechazó'}
              value={approval.resolvedBy.fullName}
            />
          ) : null}
          {approval.resolvedAt ? (
            <DataRow label="Resuelta el" value={formatDateTime(approval.resolvedAt)} />
          ) : null}
          {approval.resolutionReason ? (
            <DataRow label="Motivo del rechazo" value={approval.resolutionReason} />
          ) : null}
        </SummaryCard>
      ) : (
        <AppText variant="caption" color={colors.textSecondary}>
          {text.effect}
        </AppText>
      )}

      <ConfirmSheet
        visible={sheet === 'approve'}
        title="¿Autorizar esta solicitud?"
        confirmLabel="Sí, autorizar"
        loading={resolve.isPending}
        onConfirm={() => send('approved')}
        onCancel={() => setSheet(null)}
      >
        <AppText variant="bodyStrong">{summary}</AppText>
        <AppText variant="body">{text.effect}</AppText>
        {serverError && !alreadyResolved ? <Notice title={serverError} /> : null}
      </ConfirmSheet>

      <RejectSheet
        visible={sheet === 'reject'}
        summary={summary}
        loading={resolve.isPending}
        serverError={serverError && !alreadyResolved ? serverError : null}
        onConfirm={(reason) => send('rejected', reason)}
        onCancel={() => setSheet(null)}
      />
    </ScreenLayout>
  );
}
