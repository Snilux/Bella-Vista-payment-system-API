import { randomUUID } from 'node:crypto';
import type { Role } from '@bella-vista/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  cashbox,
  connection,
  connectionBlock,
  payment,
  person,
  roleAssignment,
  unit,
  unitHolder,
  userAccount,
} from '../../../src/db/schema/index.js';
import { testDatabaseUrl } from '../db/helpers.js';
import { useApiTestApp } from './fixture.js';

// Full permission review (1.1 §4 "Matriz de permisos" and the Roles column of 2.3 §2):
// every /v1 route, every role. The expected roles below are written from the documents, NOT
// from PERMISSIONS in @bella-vista/shared, so a change in the code that drifts from the
// contract fails here. A second block checks that a block leader never receives data of
// another block (RF-PAD-04, RNF-SEG-05).

type R = Role;
const SA: R = 'superadmin';
const PRE: R = 'president';
const TES: R = 'treasurer';
const SEC: R = 'secretary';
const VOC: R = 'member';
const JM: R = 'block_leader';
const ROLES: R[] = [SA, PRE, TES, SEC, VOC, JM];
const COMMITTEE: R[] = [PRE, TES, SEC, VOC];
const COMMITTEE_AND_JM: R[] = [...COMMITTEE, JM];

/** Account used for each role (development data, test/integration/api/fixture.ts). */
const ACCOUNT: Record<R, string> = {
  superadmin: 'admin',
  president: 'presidente',
  treasurer: 'tesorero',
  secretary: 'secretario',
  member: 'vocal',
  block_leader: 'jm.s1m01',
};

/**
 * Roles allowed per route, from 2.3 §2 (and 1.1 §4 where 2.3 says "todos", "comité" or
 * "según alcance"). Ownership rules ("quien la preparó", "su manzana") are checked by the
 * services and covered by the module tests and by the block-scope block below.
 */
const MATRIX: Record<string, R[]> = {
  // 2.1 Sesión y cuentas
  'GET /v1/accounts': [SA],
  'POST /v1/accounts': [SA],
  'POST /v1/accounts/:id/reset-password': [SA],
  'POST /v1/accounts/:id/lock': [SA],
  'POST /v1/accounts/:id/unlock': [SA],
  'POST /v1/accounts/:id/deactivate': [SA],
  // 2.2 Organización
  'GET /v1/sections': COMMITTEE_AND_JM,
  'POST /v1/sections': [SEC],
  'PATCH /v1/sections/:id': [SEC],
  'GET /v1/blocks': COMMITTEE_AND_JM,
  'GET /v1/blocks/:id': COMMITTEE_AND_JM,
  'POST /v1/blocks': [SEC],
  'PATCH /v1/blocks/:id': [SEC],
  'POST /v1/blocks/:id/leader-substitution': [SEC],
  'GET /v1/role-assignments': COMMITTEE,
  'POST /v1/role-assignments': [SEC],
  'POST /v1/role-assignments/:id/close': [SEC],
  // 2.3 Padrón y tomas
  'GET /v1/search': COMMITTEE_AND_JM,
  'GET /v1/people/matches': [JM, SEC],
  'POST /v1/people': [JM, SEC],
  'GET /v1/people/:id': COMMITTEE_AND_JM,
  'POST /v1/connections/pre-existing': [JM, SEC],
  'GET /v1/connections/:id': COMMITTEE_AND_JM,
  'POST /v1/units': [JM, SEC],
  'GET /v1/units/:id': COMMITTEE_AND_JM,
  'GET /v1/units/:id/account-statement': COMMITTEE_AND_JM,
  'POST /v1/units/:id/request-deactivation': [JM, SEC],
  'POST /v1/units/:id/request-holder-change': [JM, SEC],
  'GET /v1/suspensions': COMMITTEE,
  'POST /v1/suspensions': [SEC, PRE],
  'POST /v1/suspensions/:id/end': [SEC, PRE],
  'GET /v1/connection-requests': COMMITTEE_AND_JM,
  'GET /v1/connection-requests/:id': COMMITTEE_AND_JM,
  'POST /v1/connection-requests': [JM, SEC],
  'POST /v1/connection-requests/:id/resolve': [SEC],
  'POST /v1/connection-requests/:id/activate': [JM, SEC],
  'POST /v1/connection-requests/:id/cancel': [JM, SEC],
  'GET /v1/agreements': COMMITTEE,
  'POST /v1/agreements': [SEC],
  // 2.4 Tarifas y conceptos
  'GET /v1/rates': COMMITTEE_AND_JM,
  'POST /v1/rates': [TES],
  'GET /v1/fees': COMMITTEE_AND_JM,
  'POST /v1/fees': [TES],
  'POST /v1/fees/:id/amounts': [TES],
  // 2.5 Cobranza
  'POST /v1/payments/preview': [JM, TES, PRE],
  'POST /v1/payments': [JM, TES, PRE],
  'GET /v1/payments': COMMITTEE_AND_JM,
  'GET /v1/payments/:id': COMMITTEE_AND_JM,
  'POST /v1/payments/:id/replacements': [JM, TES],
  'POST /v1/payments/:id/request-cancellation': [JM, TES],
  // 2.6 Cajas (SEC and VOC do not hold cash: /cashboxes/mine answers FORBIDDEN from the service)
  'GET /v1/cashboxes/mine': [JM, TES, PRE],
  'GET /v1/cashboxes': COMMITTEE,
  'GET /v1/cashboxes/:id/movements': COMMITTEE_AND_JM,
  'POST /v1/cashboxes/:id/opening-balance': [TES],
  'GET /v1/handovers': [JM, PRE, TES, VOC],
  'GET /v1/handovers/:id': [JM, PRE, TES, VOC],
  'POST /v1/handovers': [JM, PRE],
  'POST /v1/handovers/:id/withdraw': [JM, PRE],
  'POST /v1/handovers/:id/confirm': [TES],
  'POST /v1/adjustments': [TES],
  // 2.7 Comité
  'GET /v1/incomes': COMMITTEE,
  'POST /v1/incomes': [TES],
  'GET /v1/expense-categories': COMMITTEE,
  'GET /v1/expenses': COMMITTEE,
  'GET /v1/expenses/:id': COMMITTEE,
  'POST /v1/expenses': [TES],
  'POST /v1/expenses/:id/pay': [TES],
  'POST /v1/expenses/:id/reject': [TES],
  'POST /v1/expenses/:id/request-refund': [TES],
  'GET /v1/plumbers': COMMITTEE,
  'GET /v1/plumbers/:id': COMMITTEE,
  'POST /v1/plumbers': [TES],
  'PATCH /v1/plumbers/:id': [TES],
  'POST /v1/plumbers/:id/salaries': [TES],
  'POST /v1/plumbers/:id/payments': [TES],
  // 2.8 Cortes, autorizaciones, reportes y bitácora
  'GET /v1/closings': COMMITTEE_AND_JM,
  'GET /v1/closings/:id': COMMITTEE_AND_JM,
  'POST /v1/closings': [JM, TES],
  'POST /v1/closings/:id/count': [JM, TES],
  'POST /v1/closings/:id/review': [PRE, VOC],
  'POST /v1/closings/:id/close': [PRE, VOC],
  'GET /v1/approvals': COMMITTEE_AND_JM,
  'POST /v1/approvals/:id/resolve': [PRE],
  'GET /v1/reports/block': COMMITTEE_AND_JM,
  'GET /v1/reports/community': COMMITTEE,
  'GET /v1/audit-log': [PRE, SA],
};

/** Routes every authenticated account may use (no permission of the matrix). */
const ANY_ACCOUNT = ['POST /v1/auth/change-password', 'POST /v1/auth/logout'];
const PUBLIC = ['POST /v1/auth/login', 'POST /v1/auth/refresh'];

/**
 * Method + path of every route, from `printRoutes` (Fastify keeps no public route list).
 * Each tree line is `<branches><segment> (<METHODS>)`, indented 4 characters per level, and
 * its full path is the concatenation of the segments above it.
 */
function routesOf(tree: string): string[] {
  const stack: string[] = [];
  const routes = new Set<string>();
  for (const line of tree.split('\n')) {
    const match = /^([│├└─\s]*)(\S+?)(?: \(([A-Z, ]+)\))?$/u.exec(line.trimEnd());
    if (!match?.[2]) continue;
    const depth = Math.floor((match[1] ?? '').length / 4);
    stack.length = depth;
    stack[depth] = match[2];
    const path = stack
      .join('')
      .replace(/\/+/g, '/')
      .replace(/(.)\/$/, '$1');
    for (const method of (match[3] ?? '').split(', ').filter(Boolean)) {
      if (method !== 'HEAD') routes.add(`${method} ${path}`);
    }
  }
  return [...routes].sort();
}

const MISSING_ID = '999999';

describe.skipIf(!testDatabaseUrl)('permission matrix and block isolation', () => {
  const ctx = useApiTestApp();

  beforeAll(async () => {
    // The bootstrap superadmin must change the password first; the matrix tests the role.
    await ctx.owner
      .update(userAccount)
      .set({ mustChangePassword: false })
      .where(eq(userAccount.username, ACCOUNT.superadmin));
  });

  const request = async (
    username: string,
    method: string,
    url: string,
    payload?: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) => {
    const res = await ctx.app.inject({
      method: method as 'GET',
      url,
      headers: { ...(await ctx.authFor(username)), ...headers },
      ...(method !== 'GET' && { payload: payload ?? {} }),
    });
    const body = res.body ? res.json() : null;
    return { status: res.statusCode, body, code: body?.error?.code as string | undefined };
  };

  describe('matrix (1.1 §4, 2.3 §2)', () => {
    it('covers every /v1 route exactly once', () => {
      const routes = routesOf(ctx.app.printRoutes({ commonPrefix: false })).filter((r) =>
        r.split(' ')[1]?.startsWith('/v1/'),
      );
      const documented = [...Object.keys(MATRIX), ...ANY_ACCOUNT, ...PUBLIC].sort();
      expect(routes).toEqual(documented);
    });

    for (const [route, allowed] of Object.entries(MATRIX)) {
      const [method = 'GET', path = ''] = route.split(' ');
      const url = path.replaceAll(':id', MISSING_ID);
      it(`${route}: ${allowed.join(', ')}`, async () => {
        const outcome: Record<string, string> = {};
        for (const role of ROLES) {
          // Empty body and a missing id: allowed roles stop at validation or NOT_FOUND, so
          // nothing is written.
          const res = await request(ACCOUNT[role], method, url);
          outcome[role] = res.code === 'FORBIDDEN' ? 'FORBIDDEN' : 'passes';
          if (res.status === 403 && res.code === 'FORBIDDEN') {
            // A denial never carries data.
            expect(res.body.error.details).toEqual({});
          }
          expect(res.status, `${role} → ${res.status} ${res.code}`).not.toBe(401);
        }
        const expected = Object.fromEntries(
          ROLES.map((role) => [role, allowed.includes(role) ? 'passes' : 'FORBIDDEN']),
        );
        expect(outcome).toEqual(expected);
      });
    }

    it('lets every role change its password and log out (no matrix permission)', async () => {
      for (const role of ROLES) {
        for (const route of ANY_ACCOUNT) {
          const [method = 'POST', url = ''] = route.split(' ');
          const res = await request(ACCOUNT[role], method, url);
          expect(res.code, `${role} ${route}`).toBe('VALIDATION_ERROR');
        }
      }
    });
  });

  describe('a block leader never receives data of another block (RF-PAD-04)', () => {
    const viewer = 'jm.s1m02';
    const other = {
      blockId: 0,
      cashboxId: 0,
      unitId: 0,
      connectionId: 0,
      paymentIds: [] as number[],
      personId: 0,
      handoverId: 0,
      closingId: 0,
      requestId: 0,
      address: '',
    };

    beforeAll(async () => {
      // The other block is S1-M01 (it has payments and a leader); the viewer leads S1-M02.
      const [leader] = await ctx.owner
        .select({ blockId: roleAssignment.blockId })
        .from(userAccount)
        .innerJoin(roleAssignment, eq(roleAssignment.id, userAccount.roleAssignmentId))
        .where(eq(userAccount.username, 'jm.s1m01'));
      other.blockId = leader?.blockId ?? 0;
      const [box] = await ctx.owner
        .select({ id: cashbox.id })
        .from(cashbox)
        .where(eq(cashbox.blockId, other.blockId));
      other.cashboxId = box?.id ?? 0;
      const [u] = await ctx.owner
        .select({ id: unit.id, connectionId: unit.connectionId, address: connection.address })
        .from(unit)
        .innerJoin(connection, eq(connection.id, unit.connectionId))
        .innerJoin(
          connectionBlock,
          and(eq(connectionBlock.connectionId, unit.connectionId), isNull(connectionBlock.validTo)),
        )
        .where(eq(connectionBlock.blockId, other.blockId))
        .limit(1);
      other.unitId = u?.id ?? 0;
      other.connectionId = u?.connectionId ?? 0;
      other.address = u?.address ?? '';
      const [holder] = await ctx.owner
        .select({ id: unitHolder.personId })
        .from(unitHolder)
        .where(and(eq(unitHolder.unitId, other.unitId), isNull(unitHolder.validTo)));
      other.personId = holder?.id ?? 0;
      other.paymentIds = (
        await ctx.owner
          .select({ id: payment.id })
          .from(payment)
          .where(eq(payment.cashboxId, other.cashboxId))
      ).map((p) => p.id);

      // Records of the other block created through the API by its own leader.
      const handover = await request(
        'jm.s1m01',
        'POST',
        '/v1/handovers',
        { declaredAmount: 100 },
        { 'idempotency-key': randomUUID() },
      );
      expect(handover.status).toBe(201);
      other.handoverId = handover.body.handover.id;
      const closing = await request('jm.s1m01', 'POST', '/v1/closings', {
        type: 'extraordinary',
      });
      expect(closing.status).toBe(201);
      other.closingId = closing.body.closing.id;
      const connectionRequest = await request('jm.s1m01', 'POST', '/v1/connection-requests', {
        applicantId: other.personId,
        address: 'Calle de prueba 10',
        blockId: other.blockId,
      });
      expect(connectionRequest.status).toBe(201);
      other.requestId = connectionRequest.body.request.id;

      expect(other.unitId).toBeGreaterThan(0);
      expect(other.paymentIds.length).toBeGreaterThan(0);
      // The holder must not also be visible to the viewer for a legitimate reason.
      const [own] = await ctx.owner
        .select({ unitId: unitHolder.unitId })
        .from(unitHolder)
        .innerJoin(unit, eq(unit.id, unitHolder.unitId))
        .innerJoin(
          connectionBlock,
          and(eq(connectionBlock.connectionId, unit.connectionId), isNull(connectionBlock.validTo)),
        )
        .innerJoin(roleAssignment, eq(roleAssignment.blockId, connectionBlock.blockId))
        .innerJoin(userAccount, eq(userAccount.roleAssignmentId, roleAssignment.id))
        .where(
          and(
            eq(unitHolder.personId, other.personId),
            isNull(unitHolder.validTo),
            eq(userAccount.username, viewer),
          ),
        );
      expect(own).toBeUndefined();
    });

    const outOfScope = async (method: string, url: string, payload?: Record<string, unknown>) => {
      const headers = method === 'POST' ? { 'idempotency-key': randomUUID() } : {};
      const res = await request(viewer, method, url, payload, headers);
      expect(res.status, `${method} ${url}`).toBe(403);
      expect(res.code, `${method} ${url}`).toBe('OUT_OF_SCOPE');
      expect(res.body.error.details).toEqual({});
    };

    it('rejects direct reads of records of another block', async () => {
      await outOfScope('GET', `/v1/units/${other.unitId}`);
      await outOfScope('GET', `/v1/units/${other.unitId}/account-statement`);
      await outOfScope('GET', `/v1/connections/${other.connectionId}`);
      await outOfScope('GET', `/v1/connection-requests/${other.requestId}`);
      await outOfScope('GET', `/v1/payments/${other.paymentIds[0]}`);
      await outOfScope('GET', `/v1/payments?blockId=${other.blockId}`);
      await outOfScope('GET', `/v1/cashboxes/${other.cashboxId}/movements`);
      await outOfScope('GET', `/v1/handovers/${other.handoverId}`);
      await outOfScope('GET', `/v1/closings/${other.closingId}`);
      await outOfScope('GET', `/v1/closings?cashboxId=${other.cashboxId}`);
      await outOfScope('GET', `/v1/connection-requests?blockId=${other.blockId}`);
      await outOfScope('GET', `/v1/reports/block?blockId=${other.blockId}`);
    });

    it('rejects operations on records of another block', async () => {
      await outOfScope('POST', '/v1/payments/preview', {
        unitId: other.unitId,
        periods: ['2026-11'],
      });
      await outOfScope('POST', `/v1/payments/${other.paymentIds[0]}/replacements`, {
        paperFolio: 'RP-9001',
      });
      await outOfScope('POST', `/v1/payments/${other.paymentIds[0]}/request-cancellation`, {
        reason: 'Prueba de alcance',
      });
      await outOfScope('POST', `/v1/units/${other.unitId}/request-deactivation`, {
        reason: 'Prueba de alcance',
      });
      await outOfScope('POST', `/v1/connection-requests/${other.requestId}/cancel`, {
        reason: 'Prueba de alcance',
      });
    });

    it('filters lists to the own block', async () => {
      const payments = await request(viewer, 'GET', '/v1/payments?limit=100');
      expect(payments.status).toBe(200);
      for (const p of payments.body.data) expect(other.paymentIds).not.toContain(p.id);
      const byUnit = await request(viewer, 'GET', `/v1/payments?unitId=${other.unitId}`);
      expect(byUnit.body.data).toEqual([]);

      const handovers = await request(viewer, 'GET', '/v1/handovers?limit=100');
      expect(handovers.body.data.map((h: { id: number }) => h.id)).not.toContain(other.handoverId);
      const closings = await request(viewer, 'GET', '/v1/closings?limit=100');
      expect(closings.body.data.map((c: { id: number }) => c.id)).not.toContain(other.closingId);
      const requests = await request(viewer, 'GET', '/v1/connection-requests?limit=100');
      expect(requests.body.data.map((r: { id: number }) => r.id)).not.toContain(other.requestId);
      const approvals = await request(viewer, 'GET', '/v1/approvals');
      const self = await ctx.accountId(viewer);
      for (const a of approvals.body.data ?? approvals.body.approvals ?? []) {
        expect(a.requestedBy.userAccountId).toBe(self);
      }
    });

    it('shows people of another block with name, distinguishing note and folio only', async () => {
      const res = await request(viewer, 'GET', `/v1/people/${other.personId}`);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body.person).sort()).toEqual(
        ['access', 'distinguishingNote', 'folio', 'fullName', 'id'].sort(),
      );
      expect(res.body.person.access).toBe('basic');

      const [holder] = await ctx.owner
        .select({ givenNames: person.givenNames })
        .from(person)
        .where(eq(person.id, other.personId));
      const search = await request(
        viewer,
        'GET',
        `/v1/search?q=${encodeURIComponent(holder?.givenNames ?? '')}`,
      );
      expect(search.status).toBe(200);
      for (const p of search.body.people) {
        expect(Object.keys(p).sort()).toEqual(
          ['distinguishingNote', 'folio', 'fullName', 'id'].sort(),
        );
      }
      const otherUnits = (
        await ctx.owner
          .select({ id: unit.id })
          .from(unit)
          .innerJoin(
            connectionBlock,
            and(
              eq(connectionBlock.connectionId, unit.connectionId),
              isNull(connectionBlock.validTo),
            ),
          )
          .where(eq(connectionBlock.blockId, other.blockId))
      ).map((u) => u.id);
      const byAddress = await request(
        viewer,
        'GET',
        `/v1/search?q=${encodeURIComponent(other.address)}`,
      );
      for (const u of [...search.body.units, ...byAddress.body.units]) {
        expect(otherUnits).not.toContain(u.id);
      }
      for (const c of [...search.body.connections, ...byAddress.body.connections]) {
        expect(c.id).not.toBe(other.connectionId);
      }
    });

    it("hides the phone of another block's leader (RF-ORG-06)", async () => {
      const res = await request(viewer, 'GET', '/v1/blocks');
      expect(res.status).toBe(200);
      const blocks = res.body.blocks ?? res.body.data;
      const otherBlock = blocks.find((b: { id: number }) => b.id === other.blockId);
      expect(otherBlock.leader).not.toBeNull();
      expect(otherBlock.leader.contactPhone).toBeNull();
    });
  });
});
