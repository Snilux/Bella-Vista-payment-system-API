import { auditChanges } from '../../src/features/audit/audit-view.js';
import {
  closingActions,
  closingTitle,
  countDifference,
  differenceText,
  figureRows,
} from '../../src/features/closings/closing-view.js';
import { blockSummaryRows, rangeLabel } from '../../src/features/reports/report-view.js';
import { blockReportHtml } from '../../src/reports/block-report.js';
import { communityReportHtml } from '../../src/reports/community-report.js';
import { escapeHtml, generatedAtText } from '../../src/reports/html.js';
import { REPORT } from '../m4/fake-m4-api.js';
import { BLOCK_REPORT, LEADER_OCTOBER, TRICKY_NAME } from './fake-m8-api.js';

// The rules the M8 screens and PDFs use (D-14, D-26; RF-REP), as tables.

describe('escapeHtml', () => {
  it.each([
    ['López & Hijos', 'López &amp; Hijos'],
    ['<script>alert(1)</script>', '&lt;script&gt;alert(1)&lt;/script&gt;'],
    ['"comillas" y \'apóstrofo\'', '&quot;comillas&quot; y &#39;apóstrofo&#39;'],
    ['Ñandú Pérez', 'Ñandú Pérez'],
    ['&amp;', '&amp;amp;'],
  ])('%s', (text, html) => {
    expect(escapeHtml(text)).toBe(html);
  });
});

describe('report templates', () => {
  const meta = { generatedAt: new Date('2026-11-18T16:42:00Z'), generatedBy: 'Ana <Ruiz> (Vocal)' };

  it('escape every text that comes from data, keep accents and use AAAA-MM-DD', () => {
    const html = blockReportHtml(BLOCK_REPORT, meta);
    expect(html).toContain(escapeHtml(TRICKY_NAME));
    expect(html).not.toContain(TRICKY_NAME);
    expect(html).toContain('Ana &lt;Ruiz&gt; (Vocal)');
    expect(html).toContain('Generado el 2026-11-18 10:42');
    expect(html).toContain('Periodo del 2026-11-01 al 2026-11-30');
    expect(html).toContain('Sección Centro');
    for (const row of blockSummaryRows(BLOCK_REPORT)) expect(html).toContain(row.value);
  });

  it('the community report carries the committee header and the totals', () => {
    const html = communityReportHtml(REPORT, meta);
    expect(html).toContain('<h1>Comité de Agua Bella Vista</h1>');
    expect(html).toContain('Reporte comunitario');
    expect(html).toMatch(/<html lang="es-MX">/);
  });

  it.each([
    ['2026-11-18T05:59:00Z', '2026-11-17 23:59'],
    ['2026-11-18T06:00:00Z', '2026-11-18 00:00'],
  ])('generatedAtText(%s) uses Mexico City: %s', (instant, text) => {
    expect(generatedAtText(new Date(instant))).toBe(text);
  });

  it.each([
    [{ from: '2026-10', to: '2026-10' }, 'Octubre 2026'],
    [{ from: '2026-08', to: '2026-10' }, 'Agosto a octubre 2026'],
    [{ from: '2025-12', to: '2026-01' }, 'Diciembre 2025 a enero 2026'],
  ])('rangeLabel %j', (range, label) => {
    expect(rangeLabel(range)).toBe(label);
  });
});

describe('closingActions (only the president closes; the member reviews)', () => {
  const leader = { role: 'block_leader' as const, username: 'jm.s1m01' };
  const president = { role: 'president' as const, username: 'presidente' };
  const member = { role: 'member' as const, username: 'vocal' };
  const treasurer = { role: 'treasurer' as const, username: 'tesorero' };
  it.each([
    ['draft', leader, { count: true, review: false, close: false }],
    ['counted', leader, { count: true, review: false, close: false }],
    ['reviewed', leader, { count: false, review: false, close: false }],
    ['draft', treasurer, { count: false, review: false, close: false }],
    ['counted', member, { count: false, review: true, close: false }],
    ['reviewed', member, { count: false, review: false, close: false }],
    ['counted', president, { count: false, review: true, close: false }],
    ['reviewed', president, { count: false, review: false, close: true }],
    ['closed', president, { count: false, review: false, close: false }],
  ] as const)('%s, %j', (status, account, actions) => {
    expect(closingActions(LEADER_OCTOBER({ status }), account)).toEqual(actions);
  });
});

describe('closing texts', () => {
  it.each([
    [345_000, null, null],
    [345_000, 345_000, null],
    [345_000, 340_000, 'Faltan $50.00. Escriba una observación.'],
    [345_000, 350_000, 'Sobran $50.00. Escriba una observación.'],
  ])('countDifference(%i, %p)', (expected, counted, text) => {
    expect(countDifference(expected, counted)).toBe(text);
  });

  it.each([
    [null, 'Sin contar'],
    [0, 'Sin diferencia'],
    [-5_000, 'Faltan $50.00'],
    [2_500, 'Sobran $25.00'],
  ])('differenceText(%p)', (difference, text) => {
    expect(differenceText(difference)).toBe(text);
  });

  it('the figures card leaves out the movements in zero', () => {
    expect(figureRows(LEADER_OCTOBER().figures).map((row) => row.label)).toEqual([
      'Saldo inicial',
      'Cobros',
      'Entregas confirmadas',
    ]);
  });

  it('titles', () => {
    expect(closingTitle(LEADER_OCTOBER())).toBe('Corte de octubre 2026');
    expect(
      closingTitle({ type: 'extraordinary', dateFrom: '2026-11-01', dateTo: '2026-11-18' }),
    ).toBe('Corte extraordinario al 2026-11-18');
  });
});

describe('auditChanges (R-05)', () => {
  it('shows before and after without passwords, hashes, tokens or keys', () => {
    expect(
      auditChanges({
        before: { status: 'draft', mustChangePassword: false },
        after: {
          status: 'closed',
          password: 'x',
          passwordHash: 'argon2',
          refreshToken: 't',
          idempotencyKey: 'k',
          mustChangePassword: true,
        },
      }),
    ).toEqual([
      { field: 'status', before: 'draft', after: 'closed' },
      { field: 'mustChangePassword', before: 'false', after: 'true' },
    ]);
  });
});
