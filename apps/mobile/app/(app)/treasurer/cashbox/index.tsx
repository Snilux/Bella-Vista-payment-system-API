// T-04 · Caja del comité
import type { Expense } from '@bella-vista/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useMyCashbox } from '../../../../src/api/useBilling.js';
import { useExpenses } from '../../../../src/api/useCommittee.js';
import { useRefresh } from '../../../../src/api/useRefresh.js';
import { EXPENSE_TAGS } from '../../../../src/features/committee/committee-view.js';
import { useAccount } from '../../../../src/session/session-store.js';
import {
  AppText,
  Button,
  Chip,
  colors,
  Header,
  ListRow,
  MenuGroup,
  MenuRow,
  ScreenLayout,
  ScreenState,
  SummaryCard,
  screenStatusOf,
  spacing,
} from '../../../../src/ui/index.js';

// The committee cashbox (Figma T-04; 3.2 §10.6; D-21): the expected balance, "Registrar gasto"
// and "Registrar ingreso", its movements (G-09) and the expenses by status: the pending ones are
// paid or rejected from T-07, a paid one can be refunded from there.

type Filter = Extract<Expense['status'], 'pending_payment' | 'paid'>;

export default function CommitteeCashbox() {
  const refresh = useRefresh();
  const account = useAccount();
  const cashbox = useMyCashbox();
  const [filter, setFilter] = useState<Filter>('pending_payment');
  const expenses = useExpenses(filter);

  return (
    <ScreenLayout withinTabs refresh={refresh}>
      <Header
        title="Caja del comité"
        {...(account ? { subtitle: `Custodio: ${account.fullName}` } : {})}
      />
      <ScreenState
        status={screenStatusOf(cashbox)}
        error={cashbox.error}
        onRetry={() => void cashbox.refetch()}
      >
        {cashbox.data ? (
          <>
            <SummaryCard heading={{ label: 'Saldo esperado', amountCents: cashbox.data.balance }} />
            <Button
              label="Registrar gasto"
              onPress={() => router.push('/treasurer/cashbox/new-expense')}
            />
            <Button
              label="Registrar ingreso"
              variant="secondary"
              onPress={() => router.push('/treasurer/cashbox/new-income')}
            />
            {cashbox.data.cashbox.id !== null ? (
              <MenuGroup>
                <MenuRow
                  label="Movimientos"
                  icon="report"
                  onPress={() => router.push(`/common/cashboxes/${cashbox.data?.cashbox.id}`)}
                />
              </MenuGroup>
            ) : null}
          </>
        ) : null}
      </ScreenState>

      <AppText variant="heading">Gastos</AppText>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        <Chip
          label="Por pagar"
          selected={filter === 'pending_payment'}
          onPress={() => setFilter('pending_payment')}
        />
        <Chip label="Pagados" selected={filter === 'paid'} onPress={() => setFilter('paid')} />
      </ScrollView>
      <ScreenState
        status={screenStatusOf(expenses, (data) => data.expenses.length === 0)}
        error={expenses.error}
        onRetry={() => void expenses.refetch()}
        empty={
          filter === 'pending_payment'
            ? {
                message: 'Todos los gastos registrados están pagados.',
              }
            : { message: 'Aún no se ha pagado ningún gasto.' }
        }
      >
        <View>
          {(expenses.data?.expenses ?? []).map((expense) => (
            <ListRow
              key={expense.id}
              title={expense.description}
              subtitle={`${expense.folio} · ${expense.category.name}`}
              tag={EXPENSE_TAGS[expense.status]}
              amountCents={expense.amount}
              onPress={() => router.push(`/treasurer/cashbox/expenses/${expense.id}`)}
            />
          ))}
        </View>
        {expenses.data?.more ? (
          <AppText variant="caption" color={colors.textSecondary}>
            Se muestran los 100 más recientes.
          </AppText>
        ) : null}
      </ScreenState>
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  chips: { gap: spacing.sm },
});
