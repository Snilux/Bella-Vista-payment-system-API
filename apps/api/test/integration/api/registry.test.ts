import {
  personDetailSchema,
  searchResponseSchema,
  suspensionPageSchema,
} from '@bella-vista/shared';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  agreement,
  connection,
  connectionRequest,
  person,
  unit,
  unitHolder,
  userAccount,
  vConnection,
} from '../../../src/db/schema/index.js';
import { businessDate } from '../../../src/lib/dates.js';
import { testDatabaseUrl } from '../db/helpers.js';
import { useApiTestApp } from './fixture.js';

// API step 4, registry module: search, people (homonyms, D-10), units, deactivation and holder
// change through approvals (D-11) and suspensions (D-06). Block leaders see payment data of
// their block only and, of other people, name, distinguishing note and folio (RF-PAD-04,
// HU-13). The cases run in order on the development data.

const today = () => businessDate(new Date(), 'America/Mexico_City');
const currentPeriod = () => today().slice(0, 7);

describe.skipIf(!testDatabaseUrl)('registry', () => {
  const ctx = useApiTestApp();

  beforeAll(async () => {
    await ctx.owner
      .update(userAccount)
      .set({ mustChangePassword: false })
      .where(eq(userAccount.username, 'admin'));
  });

  const call = async (
    method: 'GET' | 'POST',
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
  const personId = async (givenNames: string, distinguishingNote?: string) => {
    const rows = await ctx.owner
      .select({ id: person.id, note: person.distinguishingNote })
      .from(person)
      .where(eq(person.givenNames, givenNames));
    const row = distinguishingNote ? rows.find((r) => r.note === distinguishingNote) : rows[0];
    if (!row) throw new Error(`no person ${givenNames}`);
    return row.id;
  };
  const connectionAt = async (address: string) => {
    const [row] = await ctx.owner
      .select({ id: vConnection.id, blockId: vConnection.blockId })
      .from(vConnection)
      .where(eq(vConnection.address, address));
    if (!row) throw new Error(`no connection ${address}`);
    return row;
  };
  const unitByReference = async (reference: string) => {
    const [row] = await ctx.owner.select().from(unit).where(eq(unit.reference, reference));
    if (!row) throw new Error(`no unit ${reference}`);
    return row;
  };
  /** A meeting agreement (registered through the connections module in the app). */
  const newAgreement = async (
    result: 'approved_by_majority' | 'rejected' = 'approved_by_majority',
  ) => {
    const [row] = await ctx.owner
      .insert(agreement)
      .values({
        meetingDate: '2026-11-01',
        topic: 'Acuerdo de prueba',
        result,
        createdBy: await ctx.accountId('secretario'),
      })
      .returning();
    return row?.id ?? 0;
  };

  // --- Search ---------------------------------------------------------------------------------

  it('finds people ignoring accents and tolerating typos, and connections and units by folio or address', async () => {
    const noAccents = await call('GET', '/v1/search?q=jose%20luis%20hernandez', 'secretario');
    expect(noAccents.status).toBe(200);
    expect(searchResponseSchema.safeParse(noAccents.body).success).toBe(true);
    const names = noAccents.body.people.map(
      (p: { fullName: string; distinguishingNote: string }) => p.distinguishingNote,
    );
    expect(names).toEqual(expect.arrayContaining(['Papá, Av. Hidalgo', 'Hijo, Calle Morelos']));

    const typo = await call('GET', '/v1/search?q=Hernandes', 'secretario');
    expect(typo.body.people.map((p: { fullName: string }) => p.fullName)).toContain(
      'José Luis Hernández García',
    );
    const byNote = await call('GET', '/v1/search?q=tienda', 'secretario');
    expect(
      byNote.body.people.map((p: { distinguishingNote: string }) => p.distinguishingNote),
    ).toContain('La de la tienda');

    const byAddress = await call('GET', '/v1/search?q=av%20hidalgo', 'secretario');
    expect(byAddress.body.connections).toEqual([
      expect.objectContaining({ address: 'Av. Hidalgo 12', blockCode: 'S1-M01', unitCount: 3 }),
    ]);
    const frente = await unitByReference('Casa del frente');
    const byFolio = await call('GET', `/v1/search?q=${frente.folio}`, 'secretario');
    expect(byFolio.body.units).toEqual([
      expect.objectContaining({
        id: frente.id,
        blockCode: 'S1-M01',
        holder: expect.objectContaining({ fullName: 'José Luis Hernández García' }),
      }),
    ]);

    expect((await call('GET', '/v1/search?q=a', 'secretario')).body.error.code).toBe(
      'VALIDATION_ERROR',
    );
  });

  it('shows a block leader connections and units of their block only, and basic data of people', async () => {
    const own = await call('GET', '/v1/search?q=hidalgo', 'jm.s1m01');
    expect(own.body.connections).toHaveLength(1);
    const other = await call('GET', '/v1/search?q=hidalgo', 'jm.s1m02');
    expect(other.body.connections).toEqual([]);
    const frente = await unitByReference('Casa del frente');
    expect((await call('GET', `/v1/search?q=${frente.folio}`, 'jm.s1m02')).body.units).toEqual([]);

    const people = await call('GET', '/v1/search?q=hernandez', 'jm.s2m01');
    for (const found of people.body.people) {
      expect(Object.keys(found).sort()).toEqual(['distinguishingNote', 'folio', 'fullName', 'id']);
    }
  });

  // --- People ---------------------------------------------------------------------------------

  it('requires a distinguishing note for a homonym and rejects a repeated one (D-10)', async () => {
    const name = {
      givenNames: 'José Luis',
      paternalSurname: 'Hernández',
      maternalSurname: 'García',
    };
    const matches = await call(
      'GET',
      '/v1/people/matches?givenNames=jose%20luis&paternalSurname=HERNANDEZ&maternalSurname=garcia',
      'jm.s1m01',
    );
    expect(matches.body.exact).toHaveLength(2);
    const similar = await call(
      'GET',
      '/v1/people/matches?givenNames=Jose%20Luis&paternalSurname=Hernandes&maternalSurname=Garcia',
      'secretario',
    );
    expect(similar.body.similar.length).toBeGreaterThanOrEqual(2);

    const missing = await call('POST', '/v1/people', 'secretario', name);
    expect(missing.status).toBe(422);
    expect(missing.body.error).toMatchObject({ code: 'HOMONYM_WITHOUT_NOTE' });
    expect(missing.body.error.details.matches).toHaveLength(2);

    const repeated = await call('POST', '/v1/people', 'secretario', {
      ...name,
      distinguishingNote: 'Hijo, Calle Morelos',
    });
    expect(repeated).toMatchObject({
      status: 409,
      body: { error: { code: 'DUPLICATE_DISTINGUISHING_NOTE' } },
    });

    const created = await call('POST', '/v1/people', 'secretario', {
      ...name,
      distinguishingNote: 'Nieto',
      phone: '5551234000',
    });
    expect(created.status).toBe(201);
    expect(personDetailSchema.safeParse(created.body.person).success).toBe(true);
    expect(created.body.person).toMatchObject({
      access: 'full',
      fullName: 'José Luis Hernández García',
      distinguishingNote: 'Nieto',
      registeredOn: today(),
      units: [],
    });
  });

  it('shows a leader in full a person holding a unit in their block, but other units only as "another block"', async () => {
    // José Luis (Hijo) holds Morelos in S1-M01; give him a unit in S1-M02 too.
    const hijo = await personId('José Luis', 'Hijo, Calle Morelos');
    const juarez = await connectionAt('Calle Juárez 8');
    const [extra] = await ctx.owner
      .insert(unit)
      .values({
        connectionId: juarez.id,
        reference: 'Casa C',
        registeredOn: '2025-01-01',
        activatedOn: '2025-01-01',
        billingStartPeriod: '2025-01-01',
        createdBy: await ctx.accountId('secretario'),
      })
      .returning();
    await ctx.owner.insert(unitHolder).values({
      unitId: extra?.id ?? 0,
      personId: hijo,
      validFrom: '2025-01-01',
      createdBy: await ctx.accountId('secretario'),
    });

    const fromS1m01 = (await call('GET', `/v1/people/${hijo}`, 'jm.s1m01')).body.person;
    expect(fromS1m01.access).toBe('full');
    expect(fromS1m01.units).toEqual([
      expect.objectContaining({ scope: 'own', address: 'Calle Morelos 45', blockCode: 'S1-M01' }),
      { scope: 'other_block' },
    ]);
    const fromS1m02 = (await call('GET', `/v1/people/${hijo}`, 'jm.s1m02')).body.person;
    expect(fromS1m02.units).toEqual([
      { scope: 'other_block' },
      expect.objectContaining({ scope: 'own', reference: 'Casa C' }),
    ]);
    // A leader of a block where he has nothing sees the basic data only.
    expect((await call('GET', `/v1/people/${hijo}`, 'jm.s2m01')).body.person).toEqual({
      access: 'basic',
      id: hijo,
      folio: expect.any(String),
      fullName: 'José Luis Hernández García',
      distinguishingNote: 'Hijo, Calle Morelos',
    });
    // The committee sees everything.
    const committee = (await call('GET', `/v1/people/${hijo}`, 'tesorero')).body.person;
    expect(committee.units.every((u: { scope: string }) => u.scope === 'own')).toBe(true);
  });

  it('shows a leader in full the applicant of a live request in their block, until it is cancelled', async () => {
    const silvia = await personId('Silvia');
    const flores = await connectionAt('Privada Las Flores 3');
    const [request] = await ctx.owner
      .insert(connectionRequest)
      .values({
        applicantId: silvia,
        address: 'Privada Las Flores 9',
        blockId: flores.blockId ?? 0,
        requestedOn: '2026-11-01',
        createdBy: await ctx.accountId('jm.s2m01'),
      })
      .returning();
    expect((await call('GET', `/v1/people/${silvia}`, 'jm.s2m01')).body.person).toMatchObject({
      access: 'full',
      connectionRequests: [
        expect.objectContaining({ status: 'requested', address: 'Privada Las Flores 9' }),
      ],
    });
    expect((await call('GET', `/v1/people/${silvia}`, 'jm.s1m01')).body.person.access).toBe(
      'basic',
    );

    await ctx.owner
      .update(connectionRequest)
      .set({ cancelledOn: today(), cancellationReason: 'Retirada' })
      .where(eq(connectionRequest.id, request?.id ?? 0));
    expect((await call('GET', `/v1/people/${silvia}`, 'jm.s2m01')).body.person.access).toBe(
      'basic',
    );
  });

  it('shows a leader in full the people they registered while they have no unit or request', async () => {
    const created = await call('POST', '/v1/people', 'jm.s1m02', {
      givenNames: 'Octavio',
      paternalSurname: 'Reyes',
      phone: '5550101010',
    });
    expect(created.body.person).toMatchObject({ access: 'full', phone: '5550101010' });
    const id = created.body.person.id;
    expect((await call('GET', `/v1/people/${id}`, 'jm.s1m02')).body.person.access).toBe('full');
    expect((await call('GET', `/v1/people/${id}`, 'jm.s1m01')).body.person.access).toBe('basic');

    // Once he holds a unit (in S1-M01) the exception ends for the leader of S1-M02.
    const hidalgo = await connectionAt('Av. Hidalgo 12');
    const added = await call('POST', '/v1/units', 'jm.s1m01', {
      connectionId: hidalgo.id,
      holderPersonId: id,
      reference: 'Local comercial',
    });
    expect(added.status).toBe(201);
    expect((await call('GET', `/v1/people/${id}`, 'jm.s1m02')).body.person.access).toBe('basic');
    expect((await call('GET', `/v1/people/${id}`, 'jm.s1m01')).body.person.access).toBe('full');
  });

  // --- Units ----------------------------------------------------------------------------------

  it('adds a family to an active connection, without opening fee, within the leader block', async () => {
    const hidalgo = await connectionAt('Av. Hidalgo 12');
    const carmen = await personId('Carmen');
    const res = await call('POST', '/v1/units', 'jm.s1m01', {
      connectionId: hidalgo.id,
      holderPersonId: carmen,
      reference: 'Departamento 2',
    });
    expect(res.status).toBe(201);
    expect(res.body.unit).toMatchObject({
      status: 'active',
      billingStartPeriod: currentPeriod(),
      registeredOn: today(),
      connection: { blockCode: 'S1-M01' },
      holder: { fullName: 'Carmen Aguilar' },
      payments: [],
    });

    // A unit that existed at startup starts billing at its first pending month (D-18).
    const old = await call('POST', '/v1/units', 'secretario', {
      connectionId: hidalgo.id,
      holderPersonId: carmen,
      reference: 'Cuarto de azotea',
      registeredOn: '2026-11-01',
      billingStartPeriod: '2025-03',
    });
    expect(old.body.unit.billingStartPeriod).toBe('2025-03');

    expect(
      (
        await call('POST', '/v1/units', 'jm.s1m02', {
          connectionId: hidalgo.id,
          holderPersonId: carmen,
        })
      ).body.error.code,
    ).toBe('OUT_OF_SCOPE');
  });

  it('refuses a family in a connection that is not active (CONNECTION_NOT_ACTIVE)', async () => {
    const juarez = await connectionAt('Calle Juárez 8');
    const suspended = await call('POST', '/v1/suspensions', 'secretario', {
      connectionId: juarez.id,
      periodFrom: currentPeriod(),
      reason: 'Fuga reportada',
      agreementId: await newAgreement(),
    });
    expect(suspended.status).toBe(201);
    const res = await call('POST', '/v1/units', 'secretario', {
      connectionId: juarez.id,
      holderPersonId: await personId('Carmen'),
    });
    expect(res).toMatchObject({
      status: 422,
      body: { error: { code: 'CONNECTION_NOT_ACTIVE', details: { status: 'suspended' } } },
    });

    const [deactivated] = await ctx.owner
      .insert(connection)
      .values({
        address: 'Calle Cerrada 1',
        activatedOn: '2020-01-01',
        deactivatedOn: '2025-01-01',
        deactivationReason: 'Demolición',
        createdBy: await ctx.accountId('secretario'),
      })
      .returning();
    const gone = await call('POST', '/v1/units', 'secretario', {
      connectionId: deactivated?.id,
      holderPersonId: await personId('Carmen'),
    });
    expect(gone.body.error).toMatchObject({
      code: 'CONNECTION_NOT_ACTIVE',
      details: { status: 'deactivated' },
    });
  });

  it('never shows a block leader the payments of another block', async () => {
    const frente = await unitByReference('Casa del frente');
    const own = await call('GET', `/v1/units/${frente.id}`, 'jm.s1m01');
    expect(own.status).toBe(200);
    expect(own.body.unit.payments).toHaveLength(2);
    expect(own.body.unit.payments[0]).toMatchObject({ total: 50_000, cancelled: false });

    const other = await call('GET', `/v1/units/${frente.id}`, 'jm.s1m02');
    expect(other).toMatchObject({ status: 403, body: { error: { code: 'OUT_OF_SCOPE' } } });
    expect(JSON.stringify(other.body)).not.toContain('50000');
    expect((await call('GET', `/v1/units/${frente.id}`, 'vocal')).status).toBe(200);
  });

  // --- Deactivation and holder change -------------------------------------------------------

  it('deactivates a unit once the president approves the request', async () => {
    const fondo = await unitByReference('Cuarto del fondo');
    const res = await call('POST', `/v1/units/${fondo.id}/request-deactivation`, 'jm.s1m01', {
      reason: 'La familia se mudó',
    });
    expect(res.status).toBe(201);
    expect(res.body.request).toMatchObject({
      type: 'deactivation',
      unitId: fondo.id,
      newHolder: null,
    });

    const again = await call('POST', `/v1/units/${fondo.id}/request-holder-change`, 'secretario', {
      newHolderId: await personId('Teresa'),
      reason: 'Otro',
    });
    expect(again.body.error).toEqual({
      code: 'INVALID_STATE',
      message: 'La unidad ya tiene una solicitud de baja o de cambio de titular pendiente.',
      details: { status: 'pending_change', action: 'request_holder_change' },
    });
    expect(
      (await call('GET', `/v1/units/${fondo.id}`, 'secretario')).body.unit.pendingChange,
    ).toEqual({
      type: 'deactivation',
      approvalId: res.body.request.approvalId,
    });

    const inbox = await call('GET', '/v1/approvals', 'presidente');
    expect(
      inbox.body.approvals.find((a: { id: number }) => a.id === res.body.request.approvalId),
    ).toMatchObject({
      type: 'unit_deactivation',
      description: `Baja de la unidad ${fondo.folio} (titular: Carmen Aguilar)`,
      subject: { type: 'unit', id: fondo.id },
    });
    const approved = await call(
      'POST',
      `/v1/approvals/${res.body.request.approvalId}/resolve`,
      'presidente',
      {
        result: 'approved',
      },
    );
    expect(approved.status).toBe(200);
    const after = (await call('GET', `/v1/units/${fondo.id}`, 'secretario')).body.unit;
    expect(after).toMatchObject({
      status: 'deactivated',
      deactivatedOn: today(),
      pendingChange: null,
    });

    const late = await call('POST', `/v1/units/${fondo.id}/request-deactivation`, 'secretario', {
      reason: 'x',
    });
    expect(late.body.error).toMatchObject({
      code: 'INVALID_STATE',
      details: { status: 'deactivated', action: 'request_deactivation' },
    });
  });

  it('changes the holder on approval: closes the history and keeps the debt and payments in the unit (D-11)', async () => {
    const alta = await unitByReference('Planta alta');
    const teresa = await personId('Teresa');
    expect(
      (
        await call('POST', `/v1/units/${alta.id}/request-holder-change`, 'secretario', {
          newHolderId: await personId('María Guadalupe', 'La de la tienda'),
          reason: 'x',
        })
      ).body.error.details.issues,
    ).toEqual([{ path: 'body.newHolderId', message: 'Esa persona ya es la titular.' }]);

    const res = await call('POST', `/v1/units/${alta.id}/request-holder-change`, 'jm.s1m01', {
      newHolderId: teresa,
      reason: 'Compró la casa',
    });
    expect(res.body.request.newHolder).toMatchObject({ fullName: 'Teresa Navarro Cruz' });
    expect(
      (
        await call('POST', `/v1/approvals/${res.body.request.approvalId}/resolve`, 'presidente', {
          result: 'approved',
        })
      ).status,
    ).toBe(200);

    const after = (await call('GET', `/v1/units/${alta.id}`, 'jm.s1m01')).body.unit;
    expect(after.holder).toMatchObject({ fullName: 'Teresa Navarro Cruz' });
    expect(after.holders).toEqual([
      expect.objectContaining({
        fullName: 'María Guadalupe López Pérez',
        validFrom: '2024-12-20',
        validTo: today(),
      }),
      expect.objectContaining({
        fullName: 'Teresa Navarro Cruz',
        validFrom: today(),
        validTo: null,
      }),
    ]);
    expect(after.payments).toHaveLength(1);

    // Rejecting a request changes nothing.
    const frente = await unitByReference('Casa del frente');
    const rejected = await call(
      'POST',
      `/v1/units/${frente.id}/request-holder-change`,
      'secretario',
      {
        newHolderId: teresa,
        reason: 'Prueba',
      },
    );
    await call('POST', `/v1/approvals/${rejected.body.request.approvalId}/resolve`, 'presidente', {
      result: 'rejected',
      reason: 'Falta el contrato',
    });
    expect(
      (await call('GET', `/v1/units/${frente.id}`, 'secretario')).body.unit.holder.fullName,
    ).toBe('José Luis Hernández García');
  });

  // --- Suspensions ----------------------------------------------------------------------------

  it('suspends a unit with an approved agreement and ends the suspension (D-06)', async () => {
    const flores = await unitByReference('Casa A');
    expect(
      (
        await call('POST', '/v1/suspensions', 'presidente', {
          unitId: flores.id,
          periodFrom: currentPeriod(),
          reason: 'Fuga',
          agreementId: await newAgreement('rejected'),
        })
      ).body.error.details.issues,
    ).toEqual([
      { path: 'body.agreementId', message: 'El acuerdo debe estar aprobado por mayoría.' },
    ]);
    expect(
      (
        await call('POST', '/v1/suspensions', 'presidente', {
          unitId: flores.id,
          connectionId: 1,
          periodFrom: currentPeriod(),
          reason: 'x',
          agreementId: 1,
        })
      ).status,
    ).toBe(400);

    const agreementId = await newAgreement();
    const morelos = await connectionAt('Calle Morelos 45');
    const [morelosUnit] = await ctx.owner
      .select()
      .from(unit)
      .where(eq(unit.connectionId, morelos.id));
    const created = await call('POST', '/v1/suspensions', 'presidente', {
      unitId: morelosUnit?.id,
      periodFrom: '2026-12',
      reason: 'Viaje largo de la familia',
      agreementId,
    });
    expect(created.status).toBe(201);
    expect(created.body.suspension).toMatchObject({
      periodFrom: '2026-12',
      periodTo: null,
      agreementId,
    });

    const overlap = await call('POST', '/v1/suspensions', 'secretario', {
      unitId: morelosUnit?.id,
      periodFrom: '2027-01',
      reason: 'Otra',
      agreementId,
    });
    expect(overlap.body.error).toMatchObject({
      code: 'INVALID_STATE',
      details: { status: 'suspended', action: 'suspend' },
    });

    const id = created.body.suspension.id;
    expect(
      (await call('POST', `/v1/suspensions/${id}/end`, 'secretario', { periodTo: '2026-11' }))
        .status,
    ).toBe(400);
    const ended = await call('POST', `/v1/suspensions/${id}/end`, 'secretario', {
      periodTo: '2027-02',
    });
    expect(ended.body.suspension).toMatchObject({ periodFrom: '2026-12', periodTo: '2027-02' });
    expect(
      (await call('POST', `/v1/suspensions/${id}/end`, 'secretario', { periodTo: '2027-03' })).body
        .error,
    ).toMatchObject({ code: 'INVALID_STATE', details: { status: 'ended', action: 'end' } });

    const detail = (await call('GET', `/v1/units/${morelosUnit?.id}`, 'secretario')).body.unit;
    expect(detail.suspensions).toEqual([
      expect.objectContaining({ target: 'unit', periodFrom: '2026-12', periodTo: '2027-02' }),
    ]);
  });

  it('lists the active suspensions with their target, and the ended ones on request (S-08)', async () => {
    // An ended one: Casa A was suspended in January and February.
    const flores = await unitByReference('Casa A');
    const past = await call('POST', '/v1/suspensions', 'secretario', {
      unitId: flores.id,
      periodFrom: '2026-01',
      reason: 'Casa deshabitada',
      agreementId: await newAgreement(),
    });
    expect(past.status).toBe(201);
    const pastId = past.body.suspension.id;
    await call('POST', `/v1/suspensions/${pastId}/end`, 'secretario', { periodTo: '2026-02' });

    const active = await call('GET', '/v1/suspensions', 'tesorero');
    expect(active.status).toBe(200);
    expect(suspensionPageSchema.safeParse(active.body).success).toBe(true);
    const juarez = await connectionAt('Calle Juárez 8');
    const morelos = await connectionAt('Calle Morelos 45');
    // Newest first: the unit of Morelos (ends in 2027, still active), then the whole Juárez.
    expect(active.body.data).toEqual([
      expect.objectContaining({
        target: 'unit',
        periodFrom: '2026-12',
        periodTo: '2027-02',
        connection: expect.objectContaining({ id: morelos.id, address: 'Calle Morelos 45' }),
        unit: expect.objectContaining({ holderName: expect.any(String) }),
        agreement: { id: expect.any(Number), folio: expect.stringMatching(/^AC-/) },
      }),
      expect.objectContaining({
        target: 'connection',
        reason: 'Fuga reportada',
        periodTo: null,
        connection: expect.objectContaining({ id: juarez.id, blockCode: expect.any(String) }),
        unit: null,
      }),
    ]);
    expect(active.body.data.map((item: { id: number }) => item.id)).not.toContain(pastId);
    expect(active.body.next).toBeNull();

    const ended = await call('GET', '/v1/suspensions?status=ended', 'vocal');
    expect(ended.body.data.map((item: { id: number }) => item.id)).toEqual([pastId]);
    const all = await call('GET', '/v1/suspensions?status=all', 'presidente');
    expect(all.body.data).toHaveLength(3);

    // Filters: a connection (its own suspensions and those of its units) or a unit.
    const ofMorelos = await call('GET', `/v1/suspensions?connectionId=${morelos.id}`, 'secretario');
    expect(ofMorelos.body.data.map((item: { target: string }) => item.target)).toEqual(['unit']);
    const ofFlores = await call(
      'GET',
      `/v1/suspensions?status=all&unitId=${flores.id}`,
      'secretario',
    );
    expect(ofFlores.body.data.map((item: { id: number }) => item.id)).toEqual([pastId]);

    // Pages of { data, next }.
    const first = await call('GET', '/v1/suspensions?status=all&limit=2', 'secretario');
    // Newest first: the ended one of Casa A was registered last.
    expect(first.body.data.map((item: { id: number }) => item.id)[0]).toBe(pastId);
    expect(first.body.next).not.toBeNull();
    const second = await call(
      'GET',
      `/v1/suspensions?status=all&limit=2&cursor=${first.body.next}`,
      'secretario',
    );
    expect(second.body).toEqual({
      data: [expect.objectContaining({ target: 'connection', reason: 'Fuga reportada' })],
      next: null,
    });
    expect((await call('GET', '/v1/suspensions?status=otro', 'secretario')).status).toBe(400);
  });

  // --- Permissions ----------------------------------------------------------------------------

  const cases: [string, 'GET' | 'POST', string, Record<string, unknown> | undefined, string[]][] = [
    ['search', 'GET', '/v1/search?q=abc', undefined, ['admin']],
    ['list suspensions', 'GET', '/v1/suspensions', undefined, ['admin', 'jm.s1m01']],
    [
      'person matches',
      'GET',
      '/v1/people/matches?givenNames=A&paternalSurname=B',
      undefined,
      ['admin', 'presidente', 'tesorero', 'vocal'],
    ],
    [
      'create person',
      'POST',
      '/v1/people',
      { givenNames: 'A', paternalSurname: 'B' },
      ['admin', 'presidente', 'tesorero', 'vocal'],
    ],
    ['person detail', 'GET', '/v1/people/1', undefined, ['admin']],
    [
      'create unit',
      'POST',
      '/v1/units',
      { connectionId: 1, holderPersonId: 1 },
      ['admin', 'presidente', 'tesorero', 'vocal'],
    ],
    ['unit detail', 'GET', '/v1/units/1', undefined, ['admin']],
    [
      'request deactivation',
      'POST',
      '/v1/units/1/request-deactivation',
      { reason: 'x' },
      ['admin', 'presidente', 'tesorero', 'vocal'],
    ],
    [
      'request holder change',
      'POST',
      '/v1/units/1/request-holder-change',
      { newHolderId: 1, reason: 'x' },
      ['admin', 'presidente', 'tesorero', 'vocal'],
    ],
    [
      'suspend',
      'POST',
      '/v1/suspensions',
      { unitId: 1, periodFrom: '2026-11', reason: 'x', agreementId: 1 },
      ['admin', 'tesorero', 'vocal', 'jm.s1m01'],
    ],
    [
      'end suspension',
      'POST',
      '/v1/suspensions/1/end',
      { periodTo: '2026-11' },
      ['admin', 'tesorero', 'vocal', 'jm.s1m01'],
    ],
  ];
  it.each(
    cases.flatMap(([name, method, url, payload, usernames]) =>
      usernames.map((username) => [name, username, method, url, payload] as const),
    ),
  )('%s is forbidden for %s', async (_name, username, method, url, payload) => {
    const res = await call(method, url, username, payload);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});
