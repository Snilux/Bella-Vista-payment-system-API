import type { AccountStatementResponse } from '@bella-vista/shared';
import type { Database } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import type { AuthenticatedAccount } from '../../plugins/auth.js';
import { assertInScope } from '../../plugins/permissions.js';
import { loadAccountStatements } from './account-statements.js';

// Billing (CU-13 to CU-16). API step 5: the account statement of a unit (RF-MEN-07). Payments
// arrive in API step 6.

export interface BillingServiceDeps {
  db: Database;
  now: () => Date;
  timeZone: string;
}

export function createBillingService(deps: BillingServiceDeps) {
  return {
    async getStatement(
      viewer: AuthenticatedAccount,
      unitId: number,
    ): Promise<AccountStatementResponse> {
      const loaded = (
        await loadAccountStatements(deps.db, [unitId], deps.now(), deps.timeZone)
      ).get(unitId);
      if (!loaded) throw new AppError('NOT_FOUND', 404, 'No existe esa unidad.');
      // A block leader only sees the debt of their own block (RF-PAD-04).
      assertInScope(viewer, loaded.blockId);
      return { statement: { unitId, ...loaded.statement } };
    },
  };
}

export type BillingService = ReturnType<typeof createBillingService>;
