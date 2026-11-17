import { RoleTabs } from '../../../src/features/session/RoleTabs.js';

// Tabs of the member role (2.5 §1), from src/session/role-menu.ts.

export default function MemberLayout() {
  return <RoleTabs forRole="member" />;
}
