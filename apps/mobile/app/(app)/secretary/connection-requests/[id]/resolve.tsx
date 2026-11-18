// S-03 · Resolver solicitud
import { formatDate, formatMoney } from '@bella-vista/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { describeError, fieldErrors } from '../../../../../src/api/error-messages.js';
import { useAgreementOptions } from '../../../../../src/api/useAgreements.js';
import {
  useConnectionRequest,
  useOpeningFee,
  useResolveConnectionRequest,
} from '../../../../../src/api/useConnectionRequests.js';
import {
  AGREEMENT_RESULT_LABELS,
  agreementLabel,
  NEEDS_AGREEMENT,
  NEEDS_REJECTION_REASON,
} from '../../../../../src/features/registry/agreement-view.js';
import { requestStatusView } from '../../../../../src/features/registry/registry-view.js';
import {
  Button,
  DataRow,
  Header,
  Notice,
  ScreenLayout,
  ScreenState,
  Select,
  SuccessScreen,
  SummaryCard,
  screenStatusOf,
  TextField,
} from '../../../../../src/ui/index.js';

// Resolve a connection request with the meeting agreement (Figma S-03; 3.2 §10.7; D-12, D-13).
// The agreement's result decides (approved difference, 3.2 §6 M5): an approved agreement
// registers the approval and charges the opening fee in force today; a rejected one registers
// the rejection, which needs a reason. The button says which one before sending.

export default function ResolveConnectionRequest() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const requestId = Number(id);
  const query = useConnectionRequest(requestId);
  const agreements = useAgreementOptions();
  const opening = useOpeningFee();
  const resolve = useResolveConnectionRequest(requestId);
  const [agreementId, setAgreementId] = useState<number | null>(null);
  const [reason, setReason] = useState('');

  const status = screenStatusOf(query);
  const request = query.data;
  if (status !== 'ready' || !request) {
    return (
      <ScreenLayout>
        <Header title="Resolver solicitud" onBack={() => router.back()} />
        <ScreenState status={status} error={query.error} onRetry={() => void query.refetch()} />
      </ScreenLayout>
    );
  }

  if (resolve.isSuccess) {
    const resolved = resolve.data.request;
    const approved = resolved.status !== 'rejected';
    return (
      <SuccessScreen
        title={approved ? 'Aprobación registrada' : 'Rechazo registrado'}
        message={
          approved
            ? 'La toma se instala cuando la apertura esté pagada.'
            : 'El solicitante puede hacer una solicitud nueva más adelante.'
        }
        onDone={() => router.back()}
        doneLabel="Listo"
      >
        <DataRow label="Solicitud" value={resolved.folio} />
        {resolved.agreement ? <DataRow label="Acuerdo" value={resolved.agreement.folio} /> : null}
        {resolved.openingCharge ? (
          <DataRow label="Apertura" value={formatMoney(resolved.openingCharge.amount)} amount />
        ) : null}
      </SuccessScreen>
    );
  }

  const header = (
    <Header
      title="Resolver solicitud"
      subtitle={`${request.folio} · ${request.applicant.fullName}`}
      onBack={() => router.back()}
    />
  );
  const data = (
    <SummaryCard tone="plain">
      <DataRow label="Dirección" value={request.address} />
      <DataRow label="Manzana" value={request.blockCode} />
      <DataRow label="Solicitada" value={formatDate(request.requestedOn)} />
    </SummaryCard>
  );

  if (request.status !== 'requested') {
    return (
      <ScreenLayout>
        {header}
        {data}
        <Notice
          icon="info"
          title="Esta solicitud ya se resolvió."
          detail={requestStatusView(request).text}
        />
      </ScreenLayout>
    );
  }

  const chosen = agreements.data?.find((item) => item.id === agreementId) ?? null;
  const approving = chosen?.result === 'approved_by_majority';
  const amount = opening.data?.currentAmount?.amount ?? null;
  const server = resolve.isError ? fieldErrors(resolve.error) : {};
  const general =
    resolve.isError && Object.keys(server).length === 0
      ? describeError(resolve.error).message
      : null;

  const missing =
    chosen === null
      ? NEEDS_AGREEMENT
      : !approving && reason.trim() === ''
        ? NEEDS_REJECTION_REASON
        : null;

  return (
    <ScreenLayout
      footer={
        <Button
          label={
            chosen === null
              ? 'Registrar resolución'
              : approving
                ? 'Registrar aprobación'
                : 'Registrar rechazo'
          }
          variant={chosen !== null && !approving ? 'danger' : 'primary'}
          loading={resolve.isPending}
          disabledReason={missing}
          onPress={() =>
            chosen &&
            resolve.mutate({
              agreementId: chosen.id,
              resolutionReason: approving ? null : reason.trim(),
            })
          }
        />
      }
    >
      {header}
      {data}
      <Select
        label="Acuerdo de junta"
        required
        options={(agreements.data ?? []).map((agreement) => ({
          value: agreement.id,
          label: agreementLabel(agreement),
          description: agreement.topic,
        }))}
        value={agreementId}
        onChange={setAgreementId}
        placeholder="Elija el acuerdo"
        help="El resultado del acuerdo decide si se aprueba o se rechaza."
        error={server.agreementId ?? null}
      />
      <Button
        label="Registrar un acuerdo nuevo"
        variant="text"
        onPress={() => router.push('/secretary/more/agreements/new')}
      />

      {chosen && approving ? (
        <Notice
          icon="alert"
          title={
            amount === null
              ? 'Al aprobar se genera el cargo de apertura con el importe vigente.'
              : `Al aprobar se genera el cargo de apertura con el importe vigente: ${formatMoney(amount)}.`
          }
          {...(opening.isSuccess && amount === null
            ? { detail: 'La apertura aún no tiene importe: el tesorero debe registrarlo primero.' }
            : {})}
        />
      ) : null}
      {chosen && !approving ? (
        <>
          <Notice
            icon="info"
            title={`El acuerdo ${chosen.folio} es de ${AGREEMENT_RESULT_LABELS[chosen.result].toLowerCase()}: se registra el rechazo.`}
          />
          <TextField
            label="Motivo del rechazo"
            required
            value={reason}
            onChangeText={setReason}
            help="El jefe de manzana y el solicitante lo leerán."
            error={server.resolutionReason ?? null}
            maxLength={500}
            multiline
          />
        </>
      ) : null}
      {general ? <Notice title={general} /> : null}
    </ScreenLayout>
  );
}
