// G-09 · Caja (saldo y movimientos)
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { useMyCashbox } from '../../../../src/api/useBilling.js';
import { movementPages, useCashboxes } from '../../../../src/api/useCashboxes.js';
import { CashboxCard } from '../../../../src/features/cashboxes/CashboxScreens.js';
import {
  cashboxTitle,
  monthOptions,
  movementSubtitle,
  movementTitle,
} from '../../../../src/features/cashboxes/cashbox-view.js';
import { businessToday } from '../../../../src/features/forms/business-date.js';
import { useCan } from '../../../../src/session/permissions.js';
import {
  Header,
  ListRow,
  Notice,
  PaginatedList,
  ScreenLayout,
  Select,
  SummaryCard,
} from '../../../../src/ui/index.js';

// The balance and movements of one cashbox (Figma G-09; 3.2 §10.2), opened with "Movimientos"
// from J-02, T-04 and R-06. The custodian sees their "Debo tener" card; the committee the
// expected balance. Movements go by month (the current one first), paginated, each with its
// date as AAAA-MM-DD, its folio and who or what it is about (read-only data of the API). The
// API decides who may see a cashbox: a block leader only theirs (OUT_OF_SCOPE otherwise).

export default function CashboxMovements() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = Number(params.id);
  const committee = useCan('committee.view');
  const mine = useMyCashbox();
  const all = useCashboxes(committee);
  const months = useMemo(() => monthOptions(businessToday()), []);
  const [monthKey, setMonthKey] = useState(months[0]?.key ?? '');
  const month = months.find((item) => item.key === monthKey) ?? months[0];

  const own = mine.data?.cashbox.id === id ? mine.data : null;
  const listed = committee ? all.data?.find((item) => item.id === id) : undefined;
  const title = own ? cashboxTitle(own.cashbox) : listed ? cashboxTitle(listed) : null;

  if (!Number.isInteger(id) || id <= 0 || !month) {
    return (
      <ScreenLayout>
        <Header title="Movimientos de caja" onBack={() => router.back()} />
        <Notice title="No se puede abrir esta caja." detail="Vuelva e inténtelo de nuevo." />
      </ScreenLayout>
    );
  }

  const pages = movementPages(id, month);
  return (
    <ScreenLayout scroll={false}>
      <Header
        title="Movimientos de caja"
        {...(title ? { subtitle: own ? `Mi caja · ${title}` : title } : {})}
        onBack={() => router.back()}
      />
      <PaginatedList
        queryKey={pages.queryKey}
        fetchPage={pages.fetchPage}
        keyExtractor={(item) => `${item.kind}-${item.tableName}-${item.recordId}`}
        header={
          <>
            {own ? (
              <CashboxCard cashbox={own} support={own.cashbox.type === 'support'} />
            ) : listed ? (
              <SummaryCard heading={{ label: 'Saldo esperado', amountCents: listed.balance }} />
            ) : null}
            <Select
              label="Mes"
              options={months.map((item) => ({ value: item.key, label: item.label }))}
              value={month.key}
              onChange={setMonthKey}
            />
          </>
        }
        renderItem={(item) => (
          <ListRow
            title={movementTitle(item)}
            subtitle={movementSubtitle(item)}
            amountCents={item.amount}
          />
        )}
        empty={{
          message: `No hubo movimientos en ${month.label.toLowerCase()}.`,
        }}
      />
    </ScreenLayout>
  );
}
