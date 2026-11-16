import {
  blockListResponseSchema,
  roleAssignmentListResponseSchema,
  sectionListResponseSchema,
} from '@bella-vista/shared';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { auditLog, person, roleAssignment, userAccount } from '../../../src/db/schema/index.js';
import { DEV_PASSWORD } from '../../../src/db/seed/dev-data.js';
import { businessDate } from '../../../src/lib/dates.js';
import { testDatabaseUrl } from '../db/helpers.js';
import { useApiTestApp } from './fixture.js';

// API step 3, organization module: sections and blocks (SEC registers, the rest consult),
// role assignments registered by SEC and approved by PRE through the approvals module (D-09,
// D-19, D-22, RF-ORG). The cases run in order and share the database.

const today = () => businessDate(new Date(), 'America/Mexico_City');

describe.skipIf(!testDatabaseUrl)('organization', () => {
  const ctx = useApiTestApp();

  beforeAll(async () => {
    await ctx.owner
      .update(userAccount)
      .set({ mustChangePassword: false })
      .where(eq(userAccount.username, 'admin'));
  });

  const call = async (
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    username: string,
    payload?: Record<string, unknown>,
  ) => {
    const res = await ctx.app.inject({
      method,
      url,
      headers: await ctx.authFor(username),
      ...(payload && { payload }),
    });
    return { status: res.statusCode, body: res.json() };
  };
  const personId = async (givenNames: string, paternalSurname: string) => {
    const [row] = await ctx.owner
      .select({ id: person.id })
      .from(person)
      .where(and(eq(person.givenNames, givenNames), eq(person.paternalSurname, paternalSurname)));
    if (!row) throw new Error(`no person ${givenNames}`);
    return row.id;
  };
  const blockByCode = async (fullCode: string) => {
    const res = await call('GET', '/v1/blocks', 'secretario');
    return res.body.blocks.find((b: { fullCode: string }) => b.fullCode === fullCode);
  };
  const resolve = (approvalId: number, body: Record<string, unknown>) =>
    call('POST', `/v1/approvals/${approvalId}/resolve`, 'presidente', body);

  // --- Sections -------------------------------------------------------------------------------

  it('lists the sections for the committee and the block leaders', async () => {
    for (const username of ['presidente', 'tesorero', 'secretario', 'vocal', 'jm.s1m01']) {
      const res = await call('GET', '/v1/sections', username);
      expect(res.status).toBe(200);
      expect(sectionListResponseSchema.safeParse(res.body).success).toBe(true);
      expect(res.body.sections.map((s: { code: string }) => s.code)).toEqual(['S1', 'S2']);
    }
  });

  it('lets the secretary create, rename and deactivate a section, with its audit', async () => {
    const created = await call('POST', '/v1/sections', 'secretario', {
      code: ' s3 ',
      name: 'Sección Sur',
    });
    expect(created).toMatchObject({
      status: 201,
      body: { section: { code: 'S3', name: 'Sección Sur', active: true } },
    });
    const id = created.body.section.id;

    expect(
      await call('POST', '/v1/sections', 'secretario', { code: 'S3', name: 'Otra' }),
    ).toMatchObject({
      status: 409,
      body: { error: { code: 'DUPLICATE_CODE', details: { field: 'code', value: 'S3' } } },
    });
    expect(
      (await call('POST', '/v1/sections', 'secretario', { code: 'S4', name: 'Sección Centro' }))
        .body.error,
    ).toMatchObject({ code: 'DUPLICATE_CODE', details: { field: 'name' } });

    const renamed = await call('PATCH', `/v1/sections/${id}`, 'secretario', {
      name: 'Sección Sur Poniente',
      active: false,
    });
    expect(renamed.body.section).toMatchObject({ name: 'Sección Sur Poniente', active: false });
    expect(
      (await call('PATCH', `/v1/sections/${id}`, 'secretario', { name: 'Sección Lomas' })).body
        .error.code,
    ).toBe('DUPLICATE_CODE');
    expect((await call('PATCH', `/v1/sections/${id}`, 'secretario', {})).body.error.code).toBe(
      'VALIDATION_ERROR',
    );

    const [entry] = await ctx.owner
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.tableName, 'section'),
          eq(auditLog.action, 'update'),
          eq(auditLog.recordId, id),
        ),
      );
    expect(entry).toMatchObject({
      role: 'secretary',
      before: { name: 'Sección Sur', active: true },
      after: { name: 'Sección Sur Poniente', active: false },
    });

    // No blocks in an inactive section.
    const blocked = await call('POST', '/v1/blocks', 'secretario', { sectionId: id, code: 'M01' });
    expect(blocked.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { issues: [{ path: 'body.sectionId', message: 'La sección está inactiva.' }] },
    });
  });

  // --- Blocks ---------------------------------------------------------------------------------

  it('lists the blocks with their current leader; the phone only for the committee and that leader', async () => {
    const committee = await call('GET', '/v1/blocks', 'tesorero');
    expect(blockListResponseSchema.safeParse(committee.body).success).toBe(true);
    const byCode = (body: { blocks: { fullCode: string }[] }, code: string) =>
      body.blocks.find((b) => b.fullCode === code);
    expect(byCode(committee.body, 'S1-M01')).toMatchObject({
      code: 'M01',
      leader: { fullName: 'Laura Méndez Ruiz', contactPhone: '5551002001' },
    });
    expect(byCode(committee.body, 'S2-M02')).toMatchObject({ leader: null });

    const otherLeader = await call('GET', '/v1/blocks', 'jm.s1m02');
    expect(byCode(otherLeader.body, 'S1-M01')).toMatchObject({
      leader: { fullName: 'Laura Méndez Ruiz', contactPhone: null },
    });
    expect(byCode(otherLeader.body, 'S1-M02')).toMatchObject({
      leader: { contactPhone: '5551002002' },
    });

    const s1 = committee.body.blocks.find((b: { fullCode: string }) => b.fullCode === 'S1-M01');
    const filtered = await call('GET', `/v1/blocks?sectionId=${s1.sectionId}`, 'vocal');
    expect(filtered.body.blocks.map((b: { fullCode: string }) => b.fullCode)).toEqual([
      'S1-M01',
      'S1-M02',
    ]);
    expect((await call('GET', `/v1/blocks/${s1.id}`, 'jm.s2m01')).body.block.fullCode).toBe(
      'S1-M01',
    );
    expect((await call('GET', '/v1/blocks/999999', 'secretario')).body.error.code).toBe(
      'NOT_FOUND',
    );
  });

  it('lets the secretary create and edit blocks', async () => {
    const s1 = (await blockByCode('S1-M01')).sectionId;
    const created = await call('POST', '/v1/blocks', 'secretario', {
      sectionId: s1,
      code: 'm03',
      name: 'La Loma',
    });
    expect(created).toMatchObject({
      status: 201,
      body: {
        block: { code: 'M03', fullCode: 'S1-M03', name: 'La Loma', active: true, leader: null },
      },
    });
    expect(
      (await call('POST', '/v1/blocks', 'secretario', { sectionId: s1, code: 'M03' })).body.error,
    ).toMatchObject({ code: 'DUPLICATE_CODE', details: { value: 'S1-M03' } });

    const edited = await call('PATCH', `/v1/blocks/${created.body.block.id}`, 'secretario', {
      name: null,
    });
    expect(edited.body.block).toMatchObject({ name: null, fullCode: 'S1-M03' });
  });

  // --- Role assignments -------------------------------------------------------------------

  it('lists the assignments with their derived status for the committee', async () => {
    const res = await call('GET', '/v1/role-assignments', 'vocal');
    expect(res.status).toBe(200);
    expect(roleAssignmentListResponseSchema.safeParse(res.body).success).toBe(true);
    const president = res.body.assignments.find((a: { role: string }) => a.role === 'president');
    expect(president).toMatchObject({
      status: 'active',
      hasAccount: true,
      person: { fullName: 'Ana Salinas' },
    });
    const silvia = res.body.assignments.find(
      (a: { person: { fullName: string } }) => a.person.fullName === 'Silvia Montes',
    );
    expect(silvia).toMatchObject({ role: 'member', status: 'active', hasAccount: false });

    const leaders = await call(
      'GET',
      '/v1/role-assignments?role=block_leader&status=active',
      'tesorero',
    );
    expect(leaders.body.assignments).toHaveLength(3);
  });

  it('keeps one leader per block: a pending request already holds it (D-09)', async () => {
    const s2m02 = await blockByCode('S2-M02');
    const teresa = await personId('Teresa', 'Navarro');
    const ernesto = await personId('Ernesto', 'Vázquez');

    const created = await call('POST', '/v1/role-assignments', 'secretario', {
      personId: teresa,
      role: 'block_leader',
      blockId: s2m02.id,
      contactPhone: '5551009999',
      startDate: '2026-11-01',
    });
    expect(created.status).toBe(201);
    expect(created.body.assignment).toMatchObject({
      status: 'pending',
      blockCode: 'S2-M02',
      hasAccount: false,
    });

    // A second request for the same block, while the first is pending.
    const second = await call('POST', '/v1/role-assignments', 'secretario', {
      personId: ernesto,
      role: 'block_leader',
      blockId: s2m02.id,
      contactPhone: '5551008888',
      startDate: '2026-11-01',
    });
    expect(second).toMatchObject({
      status: 409,
      body: {
        error: {
          code: 'LEADER_ALREADY_ASSIGNED',
          message: 'La manzana S2-M02 ya tiene jefe o una solicitud pendiente.',
        },
      },
    });

    // The president sees it in the inbox with its description; the secretary as theirs.
    const inbox = await call('GET', '/v1/approvals', 'presidente');
    const item = inbox.body.approvals.find(
      (a: { id: number }) => a.id === created.body.assignment.approvalId,
    );
    expect(item).toMatchObject({
      type: 'role_assignment',
      reason: 'Registro de jefe de manzana de la manzana S2-M02',
      description: 'Jefe de manzana S2-M02: Teresa Navarro Cruz (desde 2026-11-01)',
      requestedBy: { username: 'secretario' },
    });
    const own = await call('GET', '/v1/approvals', 'secretario');
    expect(own.body.approvals.map((a: { id: number }) => a.id)).toContain(item.id);

    // Rejecting closes the assignment (end = start) and frees the block.
    const rejected = await resolve(item.id, {
      result: 'rejected',
      reason: 'No vive en la manzana',
    });
    expect(rejected.status).toBe(200);
    const [closed] = await ctx.owner
      .select()
      .from(roleAssignment)
      .where(eq(roleAssignment.id, created.body.assignment.id));
    expect(closed).toMatchObject({ endDate: '2026-11-01', startDate: '2026-11-01' });
    const list = await call('GET', '/v1/role-assignments?status=rejected', 'secretario');
    expect(list.body.assignments.map((a: { id: number }) => a.id)).toContain(
      created.body.assignment.id,
    );

    // Now another person can be proposed, and once approved leads the block.
    const third = await call('POST', '/v1/role-assignments', 'secretario', {
      personId: ernesto,
      role: 'block_leader',
      blockId: s2m02.id,
      contactPhone: '5551008888',
      startDate: '2026-11-01',
      reason: 'Elegido en reunión de manzana',
    });
    expect(third.status).toBe(201);
    expect((await resolve(third.body.assignment.approvalId, { result: 'approved' })).status).toBe(
      200,
    );
    expect((await blockByCode('S2-M02')).leader).toMatchObject({
      fullName: 'Ernesto Vázquez Soto',
      contactPhone: '5551008888',
    });
    const approved = await call(
      'GET',
      '/v1/role-assignments?status=active&role=block_leader',
      'tesorero',
    );
    expect(approved.body.assignments).toHaveLength(4);

    // The superadmin now sees it among the assignments without account.
    const accounts = await call('GET', '/v1/accounts', 'admin');
    expect(
      accounts.body.assignmentsWithoutAccount.map(
        (a: { roleAssignmentId: number }) => a.roleAssignmentId,
      ),
    ).toContain(third.body.assignment.id);
  });

  it('does not let a person lead two blocks (D-09)', async () => {
    const s1m03 = await blockByCode('S1-M03');
    const res = await call('POST', '/v1/role-assignments', 'secretario', {
      personId: await personId('Laura', 'Méndez'),
      role: 'block_leader',
      blockId: s1m03.id,
      contactPhone: '5551002001',
      startDate: '2026-11-01',
    });
    expect(res.body.error).toMatchObject({
      code: 'LEADER_ALREADY_ASSIGNED',
      details: { reason: 'person_is_leader' },
    });
  });

  it('keeps a single president, treasurer and secretary', async () => {
    for (const role of ['president', 'treasurer', 'secretary']) {
      const res = await call('POST', '/v1/role-assignments', 'secretario', {
        personId: await personId('Carmen', 'Aguilar'),
        role,
        startDate: '2026-11-01',
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ROLE_ALREADY_ASSIGNED');
    }
    // Vocales are not limited.
    const member = await call('POST', '/v1/role-assignments', 'secretario', {
      personId: await personId('Carmen', 'Aguilar'),
      role: 'member',
      startDate: '2026-11-01',
    });
    expect(member.status).toBe(201);
  });

  it('validates the request', async () => {
    const noBlock = await call('POST', '/v1/role-assignments', 'secretario', {
      personId: await personId('Carmen', 'Aguilar'),
      role: 'block_leader',
      startDate: '2026-11-01',
    });
    expect(noBlock.body.error.details.issues.map((i: { path: string }) => i.path)).toEqual([
      'body.blockId',
      'body.contactPhone',
    ]);
    expect(
      (
        await call('POST', '/v1/role-assignments', 'secretario', {
          personId: 999_999,
          role: 'member',
          startDate: '2026-11-01',
        })
      ).body.error.code,
    ).toBe('NOT_FOUND');
    expect(
      (
        await call('POST', '/v1/role-assignments', 'secretario', {
          personId: await personId('Carmen', 'Aguilar'),
          role: 'superadmin',
          startDate: '2026-11-01',
        })
      ).status,
    ).toBe(400);

    const s1m03 = await blockByCode('S1-M03');
    await call('PATCH', `/v1/blocks/${s1m03.id}`, 'secretario', { active: false });
    const inactive = await call('POST', '/v1/role-assignments', 'secretario', {
      personId: await personId('Rafael', 'Domínguez'),
      role: 'block_leader',
      blockId: s1m03.id,
      contactPhone: '5551007777',
      startDate: '2026-11-01',
    });
    expect(inactive.body.error.details.issues).toEqual([
      { path: 'body.blockId', message: 'La manzana está inactiva.' },
    ]);
  });

  // --- Permissions ----------------------------------------------------------------------------

  const writes: [string, 'POST' | 'PATCH', string, Record<string, unknown>][] = [
    ['create section', 'POST', '/v1/sections', { code: 'S9', name: 'Sección X' }],
    ['update section', 'PATCH', '/v1/sections/1', { name: 'X' }],
    ['create block', 'POST', '/v1/blocks', { sectionId: 1, code: 'M09' }],
    ['update block', 'PATCH', '/v1/blocks/1', { name: 'X' }],
    [
      'register assignment',
      'POST',
      '/v1/role-assignments',
      { personId: 1, role: 'member', startDate: '2026-11-01' },
    ],
    [
      'close assignment',
      'POST',
      '/v1/role-assignments/1/close',
      { endDate: '2026-11-01', reason: 'x' },
    ],
  ];
  it.each(
    writes.flatMap(([name, method, url, payload]) =>
      ['admin', 'presidente', 'tesorero', 'vocal', 'jm.s1m01'].map(
        (username) => [name, username, method, url, payload] as const,
      ),
    ),
  )(
    '%s is forbidden for %s (only the secretary)',
    async (_name, username, method, url, payload) => {
      const res = await call(method, url, username, payload);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    },
  );

  it.each([
    ['/v1/sections', 'admin'],
    ['/v1/blocks', 'admin'],
    ['/v1/role-assignments', 'admin'],
    ['/v1/role-assignments', 'jm.s1m01'],
  ])('GET %s is forbidden for %s', async (url, username) => {
    expect((await call('GET', url, username)).body.error.code).toBe('FORBIDDEN');
  });

  // --- Closing an officer's term (last: it deactivates the president's account) ---------------

  it('does not close a block leader (replaced with the extraordinary closing, step 8)', async () => {
    const leaders = await call(
      'GET',
      '/v1/role-assignments?role=block_leader&status=active',
      'secretario',
    );
    const res = await call(
      'POST',
      `/v1/role-assignments/${leaders.body.assignments[0].id}/close`,
      'secretario',
      {
        endDate: today(),
        reason: 'Renuncia',
      },
    );
    expect(res.status).toBe(400);
    expect(res.body.error.details.issues[0].message).toMatch(/corte extraordinario/);
  });

  it('closes the president, deactivating the account, and lets a new one be registered (D-22)', async () => {
    const officers = await call('GET', '/v1/role-assignments?role=president', 'secretario');
    const current = officers.body.assignments.find(
      (a: { status: string }) => a.status === 'active',
    );

    const future = await call('POST', `/v1/role-assignments/${current.id}/close`, 'secretario', {
      endDate: '2099-01-01',
      reason: 'Fin de periodo',
    });
    expect(future.body.error.details.issues).toEqual([
      { path: 'body.endDate', message: 'La fecha de fin no puede ser posterior a hoy.' },
    ]);

    const session = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { username: 'presidente', password: DEV_PASSWORD },
    });
    expect(session.statusCode).toBe(200);

    const closed = await call('POST', `/v1/role-assignments/${current.id}/close`, 'secretario', {
      endDate: today(),
      reason: 'Fin de periodo según acta de asamblea',
    });
    expect(closed.status).toBe(200);
    expect(closed.body.assignment).toMatchObject({ endDate: today(), status: 'active' });

    // The account is deactivated at once and its sessions end.
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { username: 'presidente', password: DEV_PASSWORD },
    });
    expect(login.json().error.code).toBe('ACCOUNT_DISABLED');
    const refreshed = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: session.json().refreshToken },
    });
    expect(refreshed.statusCode).toBe(401);

    const [entry] = await ctx.owner
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'close'), eq(auditLog.recordId, current.id)));
    expect(entry).toMatchObject({
      role: 'secretary',
      reason: 'Fin de periodo según acta de asamblea',
    });

    // The role is free for the newly elected president.
    const successor = await call('POST', '/v1/role-assignments', 'secretario', {
      personId: await personId('Rafael', 'Domínguez'),
      role: 'president',
      startDate: today(),
    });
    expect(successor.status).toBe(201);
    expect(successor.body.assignment.status).toBe('pending');

    // Closing it twice is refused.
    const again = await call('POST', `/v1/role-assignments/${current.id}/close`, 'secretario', {
      endDate: today(),
      reason: 'Otra vez',
    });
    expect(again.body.error.details.issues).toEqual([
      { path: 'params.id', message: 'La asignación ya está cerrada.' },
    ]);
  });
});
