import { ERROR_CODES } from '@bella-vista/shared';
import {
  describeError,
  ERROR_MESSAGES,
  fieldErrors,
  SUBSTITUTION_MESSAGES,
} from '../../src/api/error-messages.js';
import { ApiError, CLIENT_ERROR_CODES } from '../../src/api/errors.js';

// Mensajes de error (3.2 §11.3): every code the API can return has a Spanish message.

describe('coverage', () => {
  it.each([...ERROR_CODES, ...CLIENT_ERROR_CODES])('%s has a message and an action', (code) => {
    const info = ERROR_MESSAGES[code];
    expect(info).toBeDefined();
    const message = typeof info.message === 'function' ? info.message({}) : info.message;
    expect(message.trim().length).toBeGreaterThan(0);
  });

  it('has no messages for codes the API does not have', () => {
    const known = new Set<string>([...ERROR_CODES, ...CLIENT_ERROR_CODES]);
    expect(Object.keys(ERROR_MESSAGES).filter((code) => !known.has(code))).toEqual([]);
  });

  it('speaks with "usted" (2.4 §7): no "tú" forms', () => {
    const informal = /\b(tu|tus|tú|puedes|intenta|inicia|espera|escribe|revisa|elige|confirma)\b/i;
    for (const code of [...ERROR_CODES, ...CLIENT_ERROR_CODES]) {
      const info = ERROR_MESSAGES[code];
      const message = typeof info.message === 'function' ? info.message({}) : info.message;
      expect([code, message]).toEqual([code, expect.not.stringMatching(informal)]);
    }
  });
});

describe('describeError', () => {
  it('uses the app text and action for known codes', () => {
    const error = new ApiError('FORBIDDEN', 403, 'Su cargo no tiene permiso para esta operación.');
    expect(describeError(error)).toEqual({
      code: 'FORBIDDEN',
      message: 'No tiene permiso para esta acción.',
      action: 'none',
    });
  });

  it('builds TOTAL_CHANGED with the amounts the API sends', () => {
    const error = new ApiError('TOTAL_CHANGED', 409, '', { total: 15_000, expectedTotal: 10_000 });
    expect(describeError(error)).toMatchObject({
      message:
        'El total cambió: ahora es $150.00 (antes $100.00). Revise el resumen y confirme de nuevo.',
      action: 'back-to-months',
    });
  });

  it('names the months already paid', () => {
    const error = new ApiError('PERIOD_ALREADY_PAID', 409, '', { periods: ['2026-06', '2026-07'] });
    expect(describeError(error).message).toBe(
      'Estos meses ya están pagados: Junio 2026, Julio 2026.',
    );
  });

  it('uses the server text where it carries data', () => {
    const message = 'El importe ($500.00) es mayor que lo disponible en la caja ($300.00).';
    const error = new ApiError('INSUFFICIENT_BALANCE', 422, message);
    expect(describeError(error).message).toBe(message);
  });

  it('no connection suggests retrying', () => {
    expect(describeError(new ApiError('NETWORK_ERROR', 0, ''))).toEqual({
      code: 'NETWORK_ERROR',
      message: 'No hay conexión. Revise su señal e intente de nuevo.',
      action: 'retry',
    });
  });

  it('anything else is an unexpected error', () => {
    expect(describeError(new Error('boom')).code).toBe('INTERNAL_ERROR');
  });
});

describe('fieldErrors', () => {
  it('maps VALIDATION_ERROR issues to their field', () => {
    const error = new ApiError('VALIDATION_ERROR', 400, '', {
      issues: [
        { path: 'body.paperFolio', message: 'Escriba el folio.' },
        { path: 'body.paperFolio', message: 'Otro mensaje.' },
        { path: 'body.amount', message: 'El importe debe ser mayor que cero.' },
      ],
    });
    expect(fieldErrors(error)).toEqual({
      paperFolio: 'Escriba el folio.',
      amount: 'El importe debe ser mayor que cero.',
    });
  });

  it('is empty for other errors', () => {
    expect(fieldErrors(new ApiError('FORBIDDEN', 403, ''))).toEqual({});
  });
});

describe('leader substitution (S-07, D-08)', () => {
  const refusal = (status: string) =>
    describeError(
      new ApiError('INVALID_STATE', 409, 'Mensaje de la API', {
        status,
        action: 'substitute_leader',
      }),
    ).message;

  it.each([
    ['monthly', SUBSTITUTION_MESSAGES.noClosing],
    ['extraordinary', SUBSTITUTION_MESSAGES.noClosing],
    ['draft', SUBSTITUTION_MESSAGES.notCounted],
    ['stale_closing', SUBSTITUTION_MESSAGES.staleClosing],
    ['no_leader', SUBSTITUTION_MESSAGES.noLeader],
  ])('INVALID_STATE with status %s says what is missing', (status, message) => {
    expect(refusal(status)).toBe(message);
  });

  it('asks for the extraordinary closing in the words of the committee', () => {
    expect(SUBSTITUTION_MESSAGES.noClosing).toMatch(
      /^Antes de sustituir al jefe, el tesorero debe hacer el corte extraordinario de la caja de esta manzana/,
    );
  });

  it('keeps the generic text for other operations', () => {
    expect(
      describeError(
        new ApiError('INVALID_STATE', 409, '', { status: 'draft', action: 'close_closing' }),
      ).message,
    ).toBe('Esto ya cambió. Se actualizó la pantalla.');
  });
});
