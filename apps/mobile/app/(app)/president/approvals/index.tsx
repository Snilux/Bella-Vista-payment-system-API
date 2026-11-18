// R-02 · Autorizaciones
import { router } from 'expo-router';
import { useApprovals } from '../../../../src/api/useApprovals.js';
import {
  APPROVAL_TYPE_TEXTS,
  groupByType,
} from '../../../../src/features/approvals/approval-types.js';
import {
  Header,
  MenuGroup,
  MenuRow,
  Notice,
  ScreenLayout,
  ScreenState,
  screenStatusOf,
} from '../../../../src/ui/index.js';

// The president's inbox grouped by type, with how many wait in each (2.6 R-02; 3.2 §10.8). A
// type with one request opens it (R-03); with several, the list of that type. The tab shows the
// same count, and both update as soon as a request is resolved (useResolveApproval).

export default function ApprovalsInbox() {
  const query = useApprovals('pending');
  const status = screenStatusOf(query);
  const pending = query.data ?? [];
  const groups = groupByType(pending);

  return (
    <ScreenLayout withinTabs>
      <Header
        title="Autorizaciones"
        {...(status === 'ready'
          ? { subtitle: pending.length === 1 ? '1 pendiente' : `${pending.length} pendientes` }
          : {})}
      />

      <ScreenState status={status} error={query.error} onRetry={() => void query.refetch()}>
        {groups.length === 0 ? (
          <Notice icon="success" title="No hay autorizaciones pendientes." />
        ) : (
          <MenuGroup>
            {groups.map(({ type, items }) => {
              const text = APPROVAL_TYPE_TEXTS[type];
              const [first] = items;
              return (
                <MenuRow
                  key={type}
                  label={text.label}
                  icon={text.icon}
                  count={items.length}
                  onPress={() =>
                    items.length === 1 && first
                      ? router.push(`/president/approvals/${first.id}`)
                      : router.push({ pathname: '/president/approvals/list', params: { type } })
                  }
                />
              );
            })}
          </MenuGroup>
        )}

        <MenuGroup>
          <MenuRow
            label="Resueltas recientemente"
            icon="approvals"
            onPress={() =>
              router.push({ pathname: '/president/approvals/list', params: { status: 'resolved' } })
            }
          />
        </MenuGroup>
      </ScreenState>
    </ScreenLayout>
  );
}
