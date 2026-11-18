// P-06 · Registrar instalación y activación
import {
  activateConnectionRequestRequestSchema,
  formatDate,
  formatMoney,
  formatPeriod,
  periodOfDate,
} from '@bella-vista/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { describeError, fieldErrors } from '../../../../../src/api/error-messages.js';
import { isApiError } from '../../../../../src/api/errors.js';
import {
  useActivateConnectionRequest,
  useCancelConnectionRequest,
  useConnectionRequest,
} from '../../../../../src/api/useConnectionRequests.js';
import { businessToday } from '../../../../../src/features/forms/business-date.js';
import { ReasonSheet } from '../../../../../src/features/forms/ReasonSheet.js';
import {
  CHARGE_COMES_LATER,
  canCancelRequest,
  requestStatusView,
} from '../../../../../src/features/registry/registry-view.js';
import { useCan } from '../../../../../src/session/permissions.js';
import {
  AppText,
  Button,
  colors,
  DataRow,
  Header,
  Notice,
  ScreenLayout,
  ScreenState,
  StatusTag,
  SummaryCard,
  screenStatusOf,
  TextField,
} from '../../../../../src/ui/index.js';

// Install an approved connection (Figma P-06; 3.2 §10.4): it creates the connection and its
// first family with the applicant as holder, billed from the activation month. It is also the
// page of a request opened from G-02, J-06 or S-02: it says its status and offers what fits it
// (resolve, install, cancel). With the opening unpaid the API answers OPENING_NOT_PAID: the screen
// shows it with "Ir a cobrar" disabled, since collecting arrives in M6 (3.2 §6, M6 row).

type Field = 'activatedOn' | 'address' | 'reference';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default function ActivateConnection() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const requestId = Number(id);
  const query = useConnectionRequest(requestId);
  const activate = useActivateConnectionRequest(requestId);
  const cancel = useCancelConnectionRequest(requestId);
  const canManage = useCan('connectionRequests.manage');
  const canResolve = useCan('connectionRequests.resolve');
  const [activatedOn, setActivatedOn] = useState(businessToday());
  const [address, setAddress] = useState('');
  const [reference, setReference] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [cancelling, setCancelling] = useState(false);

  const status = screenStatusOf(query);
  const request = query.data;
  if (status !== 'ready' || !request) {
    return (
      <ScreenLayout>
        <Header title="Solicitud de toma" onBack={() => router.back()} />
        <ScreenState status={status} error={query.error} onRetry={() => void query.refetch()} />
      </ScreenLayout>
    );
  }

  const view = requestStatusView(request);
  const installable =
    canManage &&
    (request.status === 'pending_installation' || request.status === 'approved_pending_payment');
  const openingUnpaid =
    activate.isError && isApiError(activate.error) && activate.error.code === 'OPENING_NOT_PAID';
  const server = activate.isError ? fieldErrors(activate.error) : {};
  const general =
    activate.isError && !openingUnpaid && Object.keys(server).length === 0
      ? describeError(activate.error).message
      : null;
  const errorOf = (field: Field) => errors[field] ?? server[field] ?? null;
  const month = DATE.test(activatedOn) ? formatPeriod(periodOfDate(activatedOn)) : null;

  const submit = () => {
    const parsed = activateConnectionRequestRequestSchema.safeParse({
      activatedOn: activatedOn.trim(),
      address,
      reference,
    });
    if (!parsed.success) {
      const next: Partial<Record<Field, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0]) as Field;
        next[field] ??=
          field === 'activatedOn' ? 'Escriba la fecha como AAAA-MM-DD.' : issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    activate.mutate(parsed.data, {
      onSuccess: ({ connection }) => router.replace(`/common/connections/${connection.id}`),
    });
  };

  const footer = installable ? (
    <>
      <Button label="Activar toma" onPress={submit} loading={activate.isPending} />
      {canCancelRequest(request) ? (
        <Button label="Cancelar solicitud" variant="text" onPress={() => setCancelling(true)} />
      ) : null}
    </>
  ) : request.status === 'requested' && (canResolve || canManage) ? (
    <>
      {canResolve ? (
        <Button
          label="Resolver"
          onPress={() =>
            router.push({
              pathname: '/secretary/connection-requests/[id]/resolve',
              params: { id: String(request.id) },
            })
          }
        />
      ) : null}
      {canManage ? (
        <Button
          label="Cancelar solicitud"
          variant="secondary"
          onPress={() => setCancelling(true)}
        />
      ) : null}
    </>
  ) : request.status === 'installed' && request.connectionId !== null ? (
    <Button
      label="Ver la toma"
      variant="secondary"
      onPress={() => router.push(`/common/connections/${request.connectionId}`)}
    />
  ) : null;

  return (
    <ScreenLayout {...(footer ? { footer } : {})}>
      <Header
        title={installable ? 'Activar toma' : 'Solicitud de toma'}
        subtitle={`Solicitud ${request.folio} · ${request.applicant.fullName}`}
        onBack={() => router.back()}
      />
      {view.tag ? <StatusTag {...view.tag} /> : null}

      <SummaryCard tone="plain">
        <DataRow label="Dirección" value={request.address} />
        <DataRow label="Manzana" value={request.blockCode} />
        <DataRow label="Solicitada" value={formatDate(request.requestedOn)} />
        {request.agreement ? (
          <DataRow
            label="Acuerdo"
            value={`${request.agreement.folio} · ${request.agreement.result === 'rejected' ? 'rechazada' : 'aprobada'}`}
          />
        ) : null}
        {request.openingCharge ? (
          <DataRow
            label="Apertura"
            value={`${formatMoney(request.openingCharge.amount)} · ${
              request.openingCharge.cancelledOn
                ? 'cancelada'
                : request.status === 'approved_pending_payment'
                  ? 'por pagar'
                  : 'pagada'
            }`}
          />
        ) : null}
      </SummaryCard>
      <AppText variant="body">{view.text}</AppText>

      {installable ? (
        <>
          <TextField
            label="Fecha de activación"
            required
            value={activatedOn}
            onChangeText={setActivatedOn}
            help="AAAA-MM-DD."
            error={errorOf('activatedOn')}
            maxLength={10}
          />
          <TextField
            label="Dirección de la toma instalada"
            value={address}
            onChangeText={setAddress}
            example={request.address}
            help="Solo si es distinta de la solicitada."
            error={errorOf('address')}
            maxLength={200}
          />
          <TextField
            label="Referencia de la familia"
            value={reference}
            onChangeText={setReference}
            help="Opcional."
            error={errorOf('reference')}
            maxLength={80}
          />
          <Notice
            icon="alert"
            title={`Se creará la toma y la primera familia con ${request.applicant.fullName} como titular.${
              month ? ` Pagará completo ${month.toLowerCase()}.` : ''
            }`}
          />
        </>
      ) : null}

      {openingUnpaid ? (
        <Notice
          title={describeError(activate.error).message}
          detail={CHARGE_COMES_LATER}
          action={
            <Button
              label="Ir a cobrar"
              variant="secondary"
              disabledReason={CHARGE_COMES_LATER}
              onPress={() => undefined}
            />
          }
        />
      ) : null}
      {general ? <Notice title={general} /> : null}
      {request.status === 'approved_pending_payment' && !openingUnpaid ? (
        <AppText variant="caption" color={colors.textSecondary}>
          La toma se activa cuando la apertura esté pagada.
        </AppText>
      ) : null}

      <ReasonSheet
        visible={cancelling}
        title="Cancelar solicitud"
        summary={`Solicitud ${request.folio} · ${request.applicant.fullName}`}
        reasonLabel="Motivo"
        confirmLabel="Cancelar solicitud"
        needsReason="Escriba el motivo para poder cancelarla."
        footnote={
          request.status === 'approved_pending_payment'
            ? 'También se cancela el cargo de apertura, que aún no se ha pagado.'
            : 'La cancelación queda en la bitácora con su motivo.'
        }
        loading={cancel.isPending}
        serverError={cancel.isError ? describeError(cancel.error).message : null}
        onConfirm={(reason) => cancel.mutate(reason, { onSuccess: () => setCancelling(false) })}
        onCancel={() => setCancelling(false)}
      />
    </ScreenLayout>
  );
}
