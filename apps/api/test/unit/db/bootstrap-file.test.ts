import { describe, expect, it } from 'vitest';
import {
  InvalidBootstrapFileError,
  parseBootstrapFile,
} from '../../../src/db/seed/bootstrap-file.js';
import { generateTemporaryPassword } from '../../../src/lib/password.js';

const officer = { nombres: 'Ana', apellidoPaterno: 'Salinas', fechaInicio: '2026-11-01' };
const valid = {
  superadministrador: { nombres: 'Rolando', apellidoPaterno: 'Gómez', usuario: 'admin' },
  acuerdo: { fechaJunta: '2026-11-01', tema: 'Elección del comité' },
  presidente: officer,
  tesorero: officer,
  secretario: officer,
};

function issuesOf(content: unknown): string[] {
  try {
    parseBootstrapFile(content);
  } catch (error) {
    if (error instanceof InvalidBootstrapFileError) return error.issues;
    throw error;
  }
  return [];
}

describe('arranque.json schema', () => {
  it('accepts a minimal file and fills the optional fields with null', () => {
    const file = parseBootstrapFile(valid);
    expect(file.superadministrador).toMatchObject({
      apellidoMaterno: null,
      distintivo: null,
      telefono: null,
    });
    expect(file.acuerdo).toMatchObject({ votosFavor: null, referenciaActa: null });
  });

  it('trims text and turns blank optional text into null', () => {
    const file = parseBootstrapFile({
      ...valid,
      presidente: { ...officer, nombres: '  Ana ', distintivo: '   ' },
    });
    expect(file.presidente).toMatchObject({ nombres: 'Ana', distintivo: null });
  });

  it.each([
    [
      'missing section',
      { ...valid, acuerdo: undefined },
      'acuerdo: acuerdo es obligatorio y debe ser un objeto.',
    ],
    [
      'blank name',
      { ...valid, tesorero: { ...officer, nombres: ' ' } },
      'tesorero.nombres: nombres no puede estar vacío.',
    ],
    [
      'invalid date',
      { ...valid, secretario: { ...officer, fechaInicio: '2026-02-30' } },
      'secretario.fechaInicio: fechaInicio debe ser una fecha válida con formato AAAA-MM-DD.',
    ],
    [
      'uppercase username',
      { ...valid, superadministrador: { ...valid.superadministrador, usuario: 'Admin' } },
      'superadministrador.usuario: usuario debe tener de 3 a 32 caracteres en minúsculas: letras, números, punto, guion o guion bajo.',
    ],
    [
      'negative votes',
      { ...valid, acuerdo: { ...valid.acuerdo, votosContra: -1 } },
      'acuerdo.votosContra: Los votos no pueden ser negativos.',
    ],
    [
      'start before the meeting',
      { ...valid, presidente: { ...officer, fechaInicio: '2026-10-31' } },
      'presidente.fechaInicio: La fecha de inicio no puede ser anterior a la fecha de la junta que eligió al comité.',
    ],
    ['not an object', [], 'arranque.json debe contener un objeto.'],
  ])('rejects %s with a Spanish message', (_case, content, message) => {
    expect(issuesOf(content)).toContain(message);
  });
});

describe('generateTemporaryPassword', () => {
  it('uses 12 unambiguous characters', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateTemporaryPassword()).toMatch(/^[a-km-np-zA-HJ-NP-Z2-9]{12}$/);
    }
  });
});
