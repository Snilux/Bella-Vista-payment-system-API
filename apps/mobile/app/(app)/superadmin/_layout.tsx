import { RoleTabs } from '../../../src/features/session/RoleTabs.js';

// Tabs of the superadmin role (2.5 §1), from src/session/role-menu.ts.

export default function SuperadminLayout() {
  return <RoleTabs forRole="superadmin" />;
}
