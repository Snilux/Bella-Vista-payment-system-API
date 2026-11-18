import type { PersonBasic } from '@bella-vista/shared';
import { router } from 'expo-router';

// Navigation shared by the registry screens; a family opens its file (G-04). A person travels
// between forms as route parameters (id, folio, name, distinguishing note) so the next form
// starts with it chosen.

export const openPerson = (id: number) => router.push(`/common/people/${id}`);
export const openConnection = (id: number) => router.push(`/common/connections/${id}`);
export const openUnit = (id: number) => router.push(`/common/units/${id}`);

export type PersonParams = {
  personId?: string;
  personFolio?: string;
  personName?: string;
  personNote?: string;
};

export const personParams = (person: PersonBasic): Required<PersonParams> => ({
  personId: String(person.id),
  personFolio: person.folio,
  personName: person.fullName,
  personNote: person.distinguishingNote ?? '',
});

/** The person a form was opened with, or null. */
export function personFromParams(params: PersonParams): PersonBasic | null {
  const id = Number(params.personId);
  if (!Number.isInteger(id) || id <= 0 || !params.personName || !params.personFolio) return null;
  return {
    id,
    folio: params.personFolio,
    fullName: params.personName,
    distinguishingNote: params.personNote ? params.personNote : null,
  };
}
