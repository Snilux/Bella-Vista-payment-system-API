import type { Role } from '@bella-vista/shared';
import { router } from 'expo-router';
import { allowedFor } from '../../session/permissions.js';
import { moreOptionHref, ROLE_MENU } from '../../session/role-menu.js';
import { Header, MenuGroup, MenuRow, ScreenLayout } from '../../ui/index.js';

// C-04 · Más: the less frequent options of the role (2.5 §1), all from role-menu.ts. Each role
// folder has its own more/index.tsx that renders this with its role (forRole).

export function MoreMenu({ forRole: role }: { forRole: Role }) {
  const options = allowedFor(role, ROLE_MENU[role].more);
  return (
    <ScreenLayout withinTabs>
      <Header title="Más" />
      <MenuGroup>
        {options.map((option) => (
          <MenuRow
            key={option.screen}
            label={option.label}
            icon={option.icon}
            onPress={() => router.push(moreOptionHref(role, option))}
          />
        ))}
      </MenuGroup>
    </ScreenLayout>
  );
}
