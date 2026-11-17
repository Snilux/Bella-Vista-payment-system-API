import { RoleTabs } from '../../../src/features/session/RoleTabs.js';

// Tabs of the block_leader role (2.5 §1), from src/session/role-menu.ts.

export default function BlockLeaderLayout() {
  return <RoleTabs forRole="block_leader" />;
}
