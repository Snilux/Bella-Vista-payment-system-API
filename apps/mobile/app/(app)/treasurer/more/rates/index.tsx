// T-10 · Tarifas
import { formatMoney, formatPeriod, rateForPeriod } from '@bella-vista/shared';
import { router } from 'expo-router';
import { useRates } from '../../../../../src/api/useRates.js';
import { currentPeriod } from '../../../../../src/features/registry/registry-view.js';
import { useCan } from '../../../../../src/session/permissions.js';
import {
  Button,
  Header,
  ListRow,
  MenuGroup,
  Notice,
  ScreenLayout,
  ScreenState,
  SummaryCard,
  screenStatusOf,
} from '../../../../../src/ui/index.js';

// The monthly fee per family (Figma T-10; 3.2 §10.6; D-05, D-20): the rate in force, the ones
// waiting for the president and the history. "Registrar tarifa" registers a new one, which stays
// pending until the president authorizes it (R-03); only approved rates price the months.

const STATUS_TAGS = {
  pending: { tone: 'pending', label: 'Pendiente' },
  rejected: { tone: 'cancelled', label: 'Rechazada' },
} as const;

export default function Rates() {
  const query = useRates();
  const canRegister = useCan('rates.register');
  const status = screenStatusOf(query, (rates) => rates.length === 0);
  const rates = [...(query.data ?? [])].sort((a, b) =>
    b.effectivePeriod.localeCompare(a.effectivePeriod),
  );
  const approved = rates.filter((rate) => rate.status === 'approved');
  const current = rateForPeriod(approved, currentPeriod());
  const pending = rates.filter((rate) => rate.status === 'pending');

  return (
    <ScreenLayout
      {...(canRegister
        ? {
            footer: (
              <Button
                label="Registrar tarifa"
                onPress={() => router.push('/treasurer/more/rates/new')}
              />
            ),
          }
        : {})}
    >
      <Header title="Tarifas" subtitle="Mensualidad por familia" onBack={() => router.back()} />
      <ScreenState
        status={status}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={{ message: 'Todavía no hay tarifas registradas.', icon: 'rate' }}
      >
        {current ? (
          <SummaryCard
            heading={{
              label: `Vigente desde ${formatPeriod(current.effectivePeriod).toLowerCase()}`,
              amountCents: current.amount,
            }}
          />
        ) : (
          <Notice title="No hay una tarifa autorizada para este mes." />
        )}
        {pending.map((rate) => (
          <Notice
            key={rate.id}
            icon="alert"
            title={`La tarifa de ${formatMoney(rate.amount)} desde ${formatPeriod(rate.effectivePeriod).toLowerCase()} espera la autorización del presidente.`}
          />
        ))}
        <MenuGroup>
          {rates.map((rate) => (
            <ListRow
              key={rate.id}
              title={`${formatMoney(rate.amount)} desde ${formatPeriod(rate.effectivePeriod).toLowerCase()}`}
              subtitle={rate.agreement.folio}
              {...(rate.status === 'approved' ? {} : { tag: STATUS_TAGS[rate.status] })}
            />
          ))}
        </MenuGroup>
      </ScreenState>
    </ScreenLayout>
  );
}
