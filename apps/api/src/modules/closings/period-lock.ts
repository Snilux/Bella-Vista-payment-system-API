import type { Database, Transaction } from '../../db/client.js';
import { errors } from '../../lib/errors.js';
import { openFrom } from './closings.repository.js';

/**
 * Refuses a movement of the cashbox dated on or before its latest closed monthly closing
 * (D-14). The database trigger only checks months that have a closed closing; this also
 * covers earlier months, so backdated movements (incomes, opening balances) can never change
 * the figures of a closed closing.
 */
export async function assertDateOpen(
  exec: Database | Transaction,
  cashboxId: number,
  date: string,
): Promise<void> {
  const from = await openFrom(exec, cashboxId);
  if (from !== null && date < from) throw errors.periodClosed();
}
