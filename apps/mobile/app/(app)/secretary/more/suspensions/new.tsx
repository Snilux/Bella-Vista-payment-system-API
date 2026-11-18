// S-08 · Suspensiones (Suspender toma o familia)
import { addMonths, createSuspensionRequestSchema } from '@bella-vista/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { describeError, fieldErrors } from '../../../../../src/api/error-messages.js';
import { useAgreementOptions } from '../../../../../src/api/useAgreements.js';
import { useSearch } from '../../../../../src/api/usePersonSearch.js';
import { useSuspend } from '../../../../../src/api/useSuspensions.js';
import {
  DiscardChangesSheet,
  useDiscardGuard,
} from '../../../../../src/features/forms/DiscardChangesSheet.js';
import { agreementLabel } from '../../../../../src/features/registry/agreement-view.js';
import {
  currentPeriod,
  monthOptions,
  SUSPENSION_EFFECT,
} from '../../../../../src/features/registry/registry-view.js';
import {
  AppText,
  Button,
  colors,
  FieldMessage,
  Header,
  ListRow,
  MenuGroup,
  Notice,
  ScreenLayout,
  SearchField,
  Select,
  SummaryCard,
  TextField,
} from '../../../../../src/ui/index.js';

// Suspend a connection (all its families) or one family (S-08; 3.2 §10.7; D-06), with the first
// suspended month, a reason and an approved meeting agreement. The target is found with the
// registry search; a deactivated one is not offered (the API refuses it).

type Target = { kind: 'connection' | 'unit'; id: number; title: string; detail: string };
type Field = 'target' | 'periodFrom' | 'reason' | 'agreementId';

export default function Suspend() {
  const suspend = useSuspend();
  const agreements = useAgreementOptions('approved_by_majority');
  const [text, setText] = useState('');
  const search = useSearch(text);
  const [target, setTarget] = useState<Target | null>(null);
  const now = currentPeriod();
  const [periodFrom, setPeriodFrom] = useState<string>(now);
  const [reason, setReason] = useState('');
  const [agreementId, setAgreementId] = useState<number | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const guard = useDiscardGuard((target !== null || reason !== '') && !suspend.isSuccess);

  const server = suspend.isError ? fieldErrors(suspend.error) : {};
  const general =
    suspend.isError && Object.keys(server).length === 0
      ? describeError(suspend.error).message
      : null;
  const errorOf = (field: Field) => errors[field] ?? server[field] ?? null;

  const submit = () => {
    if (!target) {
      setErrors({ target: 'Elija la toma o la familia.' });
      return;
    }
    const parsed = createSuspensionRequestSchema.safeParse({
      ...(target.kind === 'connection' ? { connectionId: target.id } : { unitId: target.id }),
      periodFrom,
      reason,
      agreementId: agreementId ?? undefined,
    });
    if (!parsed.success) {
      const next: Partial<Record<Field, string>> = {};
      for (const issue of parsed.error.issues)
        next[String(issue.path[0]) as Field] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    suspend.mutate(parsed.data, { onSuccess: () => guard.leave(() => router.back()) });
  };

  const connections = (search.data?.connections ?? []).filter(
    (item) => item.status !== 'deactivated',
  );
  const units = (search.data?.units ?? []).filter((item) => item.status !== 'deactivated');

  return (
    <ScreenLayout
      footer={<Button label="Suspender" onPress={submit} loading={suspend.isPending} />}
    >
      <Header title="Suspender toma o familia" onBack={() => router.back()} />

      {target ? (
        <>
          <SummaryCard tone="plain">
            <AppText variant="bodyStrong">{target.title}</AppText>
            <AppText variant="caption" color={colors.textSecondary}>
              {target.detail}
            </AppText>
          </SummaryCard>
          <Button label="Cambiar" variant="text" onPress={() => setTarget(null)} />
        </>
      ) : (
        <>
          <AppText variant="label">Toma o familia *</AppText>
          <SearchField
            value={text}
            onChangeText={setText}
            placeholder="Buscar calle, folio o titular"
          />
          {errorOf('target') ? <FieldMessage error={errorOf('target')} /> : null}
          {search.tooShort ? (
            <AppText variant="caption" color={colors.textSecondary}>
              Escriba al menos 2 letras.
            </AppText>
          ) : connections.length + units.length > 0 ? (
            <MenuGroup>
              {connections.map((item) => (
                <ListRow
                  key={`c${item.id}`}
                  title={`Toma ${item.folio} · ${item.address}`}
                  subtitle={`Toda la toma: ${item.unitCount === 1 ? '1 familia' : `${item.unitCount} familias`}`}
                  onPress={() =>
                    setTarget({
                      kind: 'connection',
                      id: item.id,
                      title: `Toma ${item.folio} · ${item.address}`,
                      detail: `Se suspenden sus ${item.unitCount === 1 ? 'familia' : `${item.unitCount} familias`}.`,
                    })
                  }
                />
              ))}
              {units.map((item) => (
                <ListRow
                  key={`u${item.id}`}
                  title={`Familia ${item.folio}${item.holder ? ` · ${item.holder.fullName}` : ''}`}
                  subtitle={`Solo esta familia · ${item.address}`}
                  onPress={() =>
                    setTarget({
                      kind: 'unit',
                      id: item.id,
                      title: `Familia ${item.folio}${item.holder ? ` · ${item.holder.fullName}` : ''}`,
                      detail: `Toma ${item.connectionFolio} · ${item.address}`,
                    })
                  }
                />
              ))}
            </MenuGroup>
          ) : search.isSuccess ? (
            <AppText variant="caption" color={colors.textSecondary}>
              {`Ninguna toma ni familia coincide con «${search.searchedText}».`}
            </AppText>
          ) : null}
        </>
      )}

      <Select
        label="Desde el mes"
        required
        options={monthOptions(addMonths(now, -12), addMonths(now, 6))}
        value={periodFrom}
        onChange={setPeriodFrom}
        help="El primer mes que no se cobra."
        error={errorOf('periodFrom')}
      />
      <TextField
        label="Motivo"
        required
        value={reason}
        onChangeText={setReason}
        example="Fuga sin reparar"
        error={errorOf('reason')}
        maxLength={500}
        multiline
      />
      <Select
        optionsQuery={agreements}
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
        help="Solo acuerdos aprobados por mayoría."
        error={errorOf('agreementId')}
      />

      <Notice icon="alert" title={SUSPENSION_EFFECT} />
      {general ? <Notice title={general} /> : null}
      <DiscardChangesSheet guard={guard} />
    </ScreenLayout>
  );
}
