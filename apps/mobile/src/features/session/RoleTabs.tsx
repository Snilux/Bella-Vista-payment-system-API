import type { Role } from '@bella-vista/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Redirect, Tabs, useSegments } from 'expo-router';
import { refreshShownQueries } from '../../api/query-client.js';
import { usePendingApprovalCount } from '../../api/useApprovals.js';
import { allowedFor } from '../../session/permissions.js';
import { homeHref, ROLE_MENU } from '../../session/role-menu.js';
import { useAccount } from '../../session/session-store.js';
import { colors, TabBar } from '../../ui/index.js';

// Layout of a role folder, app/(app)/<role>/_layout.tsx: the tabs of that role (role-menu.ts)
// with the design's tab bar. An account only enters the folder of its own role; any other role
// in the URL sends it to its own home (the API would refuse the data anyway). The tabs stay
// mounted, so a tab that gains focus reloads what is older than 30 s: what other accounts did
// meanwhile shows up (M9).

export function RoleTabs({ forRole: role }: { forRole: Role }) {
  const account = useAccount();
  const queryClient = useQueryClient();
  // (app)/<role>/<tab>/<screen>: a screen opened inside a tab (A-02, A-03…) covers the tab bar,
  // as in the captures.
  const nested = useSegments().length > 3;
  // The president's "Autorizaciones" tab shows how many wait (R-02); it drops on resolving.
  const pendingApprovals = usePendingApprovalCount(
    account?.role === 'president' && role === 'president',
  );
  if (!account) return <Redirect href="/" />;
  if (account.role !== role) return <Redirect href={homeHref(account.role)} />;

  const tabs = allowedFor(role, ROLE_MENU[role].tabs);
  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.background } }}
      screenListeners={{
        focus: () => void refreshShownQueries(queryClient, { staleOnly: true }),
      }}
      tabBar={({ state, navigateToTab }) =>
        nested ? null : (
          <TabBar
            items={tabs.map((tab) => ({
              key: tab.name,
              label: tab.label,
              icon: tab.icon,
              ...(tab.screen === 'R-02' ? { badge: pendingApprovals } : {}),
            }))}
            activeKey={state.routes[state.index]?.name ?? ''}
            onSelect={(name) => {
              const route = state.routes.find((candidate) => candidate.name === name);
              if (route) navigateToTab(route.key);
            }}
          />
        )
      }
    >
      {tabs.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} />
      ))}
    </Tabs>
  );
}
