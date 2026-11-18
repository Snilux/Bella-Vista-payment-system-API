import {
  EXTRA_CHARGE_FEE_TYPES,
  type ExtraCharge,
  type Fee,
  formatMoney,
} from '@bella-vista/shared';
import { useState } from 'react';
import { describeError, describeSaveError, fieldErrors } from '../../api/error-messages.js';
import { useCancelCharge, useCreateCharge, useUnitCharges } from '../../api/useExtraCharges.js';
import { useFees } from '../../api/useRates.js';
import { useCan } from '../../session/permissions.js';
import {
  AppText,
  BottomSheet,
  Button,
  colors,
  DataRow,
  DateField,
  dateError,
  ListRow,
  MenuGroup,
  Notice,
  Radio,
  Select,
  SummaryCard,
} from '../../ui/index.js';
import { businessToday } from '../forms/business-date.js';
import { ReasonSheet } from '../forms/ReasonSheet.js';

// Extra charges of a family (G-04; D-13, D-28): the pending ones (its own and its connection's),
// collected in F-02 together with the months. Only the treasurer adds one ("Agregar cargo":
// reconnection, repair or other, for the family or its connection, with the amount in force on
// the charge date) and cancels an unpaid one with its reason; nothing is deleted.

/** The amount of a fee in force on `date` (the latest from that day or before), or null. */
export function feeAmountOn(fee: Pick<Fee, 'amounts'>, date: string): number | null {
  return (
    [...fee.amounts]
      .filter((item) => item.effectiveFrom <= date)
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]?.amount ?? null
  );
}

export const chargeSubtitle = (charge: ExtraCharge) =>
  `Cargado el ${charge.chargedOn}${charge.target === 'connection' ? ' · a la toma' : ''}`;

export function ExtraChargesSection({
  unitId,
  connectionId,
  canCharge,
}: {
  unitId: number;
  connectionId: number;
  /** False for a deactivated family: nothing new is charged. */
  canCharge: boolean;
}) {
  const manage = useCan('charges.manage');
  const charges = useUnitCharges(unitId);
  const cancel = useCancelCharge();
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState<ExtraCharge | null>(null);
  const pending = charges.data ?? [];
  if (pending.length === 0 && !(manage && canCharge)) return null;

  return (
    <>
      <AppText variant="heading">Conceptos pendientes</AppText>
      {charges.isError ? (
        <Notice title="No se pudieron cargar los conceptos." />
      ) : pending.length === 0 ? (
        <AppText variant="caption" color={colors.textSecondary}>
          Sin conceptos pendientes.
        </AppText>
      ) : (
        <MenuGroup>
          {pending.map((charge) => (
            <ListRow
              key={charge.id}
              title={charge.fee.name}
              subtitle={chargeSubtitle(charge)}
              amountCents={charge.amount}
              {...(manage
                ? {
                    onPress: () => {
                      cancel.reset();
                      setCancelling(charge);
                    },
                  }
                : {})}
            />
          ))}
        </MenuGroup>
      )}
      {manage && canCharge ? (
        <Button label="Agregar cargo" variant="secondary" onPress={() => setAdding(true)} />
      ) : null}
      {adding ? (
        <AddChargeSheet
          unitId={unitId}
          connectionId={connectionId}
          onClose={() => setAdding(false)}
        />
      ) : null}
      <ReasonSheet
        visible={cancelling !== null}
        title="Cancelar cargo"
        summary={
          cancelling
            ? `${cancelling.fee.name} · ${formatMoney(cancelling.amount)}, ${chargeSubtitle(cancelling).toLowerCase()}. Deja de cobrarse; queda en la bitácora con el motivo.`
            : ''
        }
        reasonLabel="Motivo de la cancelación"
        confirmLabel="Cancelar cargo"
        needsReason="Escriba el motivo de la cancelación."
        loading={cancel.isPending}
        serverError={cancel.isError ? describeError(cancel.error).message : null}
        onConfirm={(reason) => {
          if (cancelling) {
            cancel.mutate({ id: cancelling.id, reason }, { onSuccess: () => setCancelling(null) });
          }
        }}
        onCancel={() => setCancelling(null)}
      />
    </>
  );
}

type Target = 'unit' | 'connection';

function AddChargeSheet({
  unitId,
  connectionId,
  onClose,
}: {
  unitId: number;
  connectionId: number;
  onClose: () => void;
}) {
  const fees = useFees();
  const create = useCreateCharge();
  const today = businessToday();
  const [feeId, setFeeId] = useState<number | null>(null);
  const [target, setTarget] = useState<Target>('unit');
  const [chargedOn, setChargedOn] = useState(today);
  const [errors, setErrors] = useState<{ feeId?: string; chargedOn?: string }>({});
  const options = (fees.data ?? []).filter((fee) =>
    (EXTRA_CHARGE_FEE_TYPES as readonly string[]).includes(fee.type),
  );
  const fee = options.find((item) => item.id === feeId) ?? null;
  const dateProblem =
    dateError(chargedOn, true) ??
    (chargedOn > today ? 'La fecha del cargo no puede ser posterior a hoy.' : null);
  const amount = fee && !dateProblem ? feeAmountOn(fee, chargedOn) : null;
  const server = create.isError ? fieldErrors(create.error) : {};
  const general =
    create.isError && Object.keys(server).length === 0
      ? describeSaveError(create.error).message
      : null;

  const submit = () => {
    const next: { feeId?: string; chargedOn?: string } = {};
    if (feeId === null) next.feeId = 'Elija el concepto.';
    if (dateProblem) next.chargedOn = dateProblem;
    setErrors(next);
    if (feeId === null || dateProblem) return;
    create.mutate(
      {
        feeId,
        ...(target === 'unit' ? { unitId } : { connectionId }),
        chargedOn,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <BottomSheet
      visible
      title="Agregar cargo"
      onClose={create.isPending ? () => undefined : onClose}
      footer={
        <>
          <Button
            label="Agregar cargo"
            onPress={submit}
            loading={create.isPending}
            disabledReason={
              fee && !dateProblem && amount === null
                ? `${fee.name} no tiene importe vigente en esa fecha. Regístrelo en Más → Conceptos.`
                : null
            }
          />
          <Button label="Volver" variant="secondary" onPress={onClose} />
        </>
      }
    >
      <Select
        label="Concepto"
        required
        options={options.map((item) => ({
          value: item.id,
          label: item.name,
          ...(item.currentAmount
            ? { description: `Vigente: ${formatMoney(item.currentAmount.amount)}` }
            : { description: 'Sin importe vigente' }),
        }))}
        value={feeId}
        onChange={setFeeId}
        placeholder="Elija el concepto"
        error={errors.feeId ?? server.feeId ?? null}
      />
      <AppText variant="bodyStrong">¿A quién se carga?</AppText>
      <Radio label="A la familia" selected={target === 'unit'} onPress={() => setTarget('unit')} />
      <Radio
        label="A la toma"
        description="Lo paga cualquiera de las familias de la toma."
        selected={target === 'connection'}
        onPress={() => setTarget('connection')}
      />
      <DateField
        label="Fecha del cargo"
        required
        value={chargedOn}
        onChange={setChargedOn}
        help="Hoy o antes. El importe es el vigente del concepto en esa fecha."
        error={errors.chargedOn ?? server.chargedOn ?? null}
      />
      {fee && amount !== null ? (
        <SummaryCard tone="plain">
          <DataRow label="Importe del cargo" value={formatMoney(amount)} amount />
        </SummaryCard>
      ) : null}
      {general ? <Notice title={general} /> : null}
    </BottomSheet>
  );
}
