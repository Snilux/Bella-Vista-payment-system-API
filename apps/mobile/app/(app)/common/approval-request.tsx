// G-11 · Solicitud con motivo
import type { PersonBasic } from '@bella-vista/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { describeError, UNKNOWN_OUTCOME_MESSAGE } from '../../../src/api/error-messages.js';
import { useApprovalRequest } from '../../../src/api/useApprovalRequest.js';
import {
  isRequestType,
  MISSING_HOLDER,
  MISSING_REASON,
  REQUEST_CONFIGS,
  type RequestType,
} from '../../../src/features/approvals/approval-types.js';
import {
  DiscardChangesSheet,
  useDiscardGuard,
} from '../../../src/features/forms/DiscardChangesSheet.js';
import { PersonPicker } from '../../../src/features/people/PersonPicker.js';
import { useCan } from '../../../src/session/permissions.js';
import {
  AppText,
  Button,
  colors,
  Header,
  Notice,
  ScreenLayout,
  ScreenState,
  SuccessScreen,
  TextField,
} from '../../../src/ui/index.js';

// One form for every request that the president decides (2.6 G-11; 3.2 §10.2), opened with
// ?type=<unit_deactivation|holder_change|payment_cancellation|expense_refund>&id=<record>
// &subject=<the line under the title, e.g. "Pago PG-000981 · $200.00">. The screens that open
// it (G-04, G-05, T-07) arrive in M6 and M7. The reason is mandatory; the holder change also
// asks for the new holder. Sending goes through useMoneyOperation: a double tap sends once, the
// money requests carry an Idempotency-Key, and a request without answer offers "Reintentar" with
// the same key. Once sent it shows "Enviada al presidente" and cannot be sent again.

export default function ApprovalRequest() {
  const params = useLocalSearchParams<{ type?: string; id?: string; subject?: string }>();
  const recordId = Number(params.id);
  if (!isRequestType(params.type) || !Number.isInteger(recordId) || recordId <= 0) {
    return (
      <ScreenLayout>
        <Header title="Solicitud" onBack={() => router.back()} />
        <Notice title="No se puede abrir esta solicitud." detail="Vuelva e inténtelo de nuevo." />
      </ScreenLayout>
    );
  }
  return <RequestForm type={params.type} recordId={recordId} subject={params.subject ?? null} />;
}

function RequestForm({
  type,
  recordId,
  subject,
}: {
  type: RequestType;
  recordId: number;
  subject: string | null;
}) {
  const config = REQUEST_CONFIGS[type];
  const allowed = useCan(config.action);
  const request = useApprovalRequest(type, recordId);
  const [reason, setReason] = useState('');
  const [holder, setHolder] = useState<PersonBasic | null>(null);
  const [search, setSearch] = useState('');
  const guard = useDiscardGuard((reason !== '' || holder !== null) && request.status !== 'success');

  if (!allowed) {
    return (
      <ScreenLayout>
        <Header title={config.title} onBack={() => router.back()} />
        <ScreenState status="forbidden" />
      </ScreenLayout>
    );
  }

  if (request.status === 'success') {
    return (
      <SuccessScreen
        title="Enviada al presidente"
        message={`La solicitud queda pendiente hasta que el presidente la resuelva. ${config.meanwhile}`}
        onDone={() => router.back()}
        doneLabel="Listo"
      />
    );
  }

  const trimmed = reason.trim();
  const missing =
    trimmed === '' ? MISSING_REASON : config.needsNewHolder && !holder ? MISSING_HOLDER : null;
  const unknown = request.status === 'unknown';
  const failure = request.status === 'failed' ? describeError(request.error).message : null;

  const footer = unknown ? (
    <>
      <Button label="Reintentar" onPress={() => void request.retry()} loading={request.sending} />
      <AppText variant="caption" color={colors.textSecondary}>
        {UNKNOWN_OUTCOME_MESSAGE}
      </AppText>
    </>
  ) : (
    <Button
      label="Enviar solicitud"
      onPress={() =>
        void request.submit({ reason: trimmed, ...(holder ? { newHolderId: holder.id } : {}) })
      }
      loading={request.sending}
      loadingLabel="Enviando..."
      disabledReason={missing}
    />
  );

  return (
    <ScreenLayout footer={footer}>
      <Header
        title={config.title}
        {...(subject ? { subtitle: subject } : {})}
        onBack={() => router.back()}
      />

      {config.needsNewHolder ? (
        <PersonPicker
          label="Nuevo titular"
          value={holder}
          onChange={(person) => {
            setHolder(person);
            if (request.status === 'failed') request.reset();
          }}
          text={search}
          onChangeText={setSearch}
        />
      ) : null}

      <TextField
        label="Motivo"
        required
        value={reason}
        onChangeText={(text) => {
          setReason(text);
          if (request.status === 'failed') request.reset();
        }}
        help="Explique qué pasó; el presidente lo leerá."
        maxLength={500}
        multiline
        editable={!unknown && !request.sending}
      />

      <Notice icon="alert" title={config.meanwhile} />
      {unknown ? <Notice title="No sabemos si se registró." /> : null}
      {failure ? <Notice title={failure} /> : null}
      <DiscardChangesSheet guard={guard} />
    </ScreenLayout>
  );
}
