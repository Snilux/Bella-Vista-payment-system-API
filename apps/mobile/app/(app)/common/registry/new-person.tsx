// P-02 · Registrar persona
import { createPersonRequestSchema, type PersonBasic } from '@bella-vista/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { describeError, fieldErrors } from '../../../../src/api/error-messages.js';
import { isApiError } from '../../../../src/api/errors.js';
import { useCreatePerson, usePersonMatches } from '../../../../src/api/useRegistry.js';
import {
  DiscardChangesSheet,
  useDiscardGuard,
} from '../../../../src/features/forms/DiscardChangesSheet.js';
import { personLine } from '../../../../src/features/people/PersonPicker.js';
import { useAccount } from '../../../../src/session/session-store.js';
import {
  AppText,
  Button,
  colors,
  Header,
  ListRow,
  MenuGroup,
  Notice,
  Radio,
  ScreenLayout,
  SummaryCard,
  spacing,
  TextField,
} from '../../../../src/ui/index.js';

// Register a person (Figma P-02; 3.2 §10.4; D-10: no CURP). "Guardar" first asks the API for
// people with the same name. With homonyms the screen lists them and asks "¿Es la misma
// persona?" (a single choice): the same one opens their file (G-02) and registers nothing;
// another one needs a distinguishing note (the block code is proposed, or a short reference).
// Similar names are shown as a reminder only. Name + distinguishing note is unique.

type Field = 'givenNames' | 'paternalSurname' | 'maternalSurname' | 'distinguishingNote' | 'phone';
type Matches = { key: string; exact: PersonBasic[]; similar: PersonBasic[] };
/** null: not decided yet; a person: it is the same one; 'other': another person. */
type Decision = PersonBasic | 'other' | null;

const nameKey = (...parts: string[]) => parts.map((part) => part.trim().toLowerCase()).join('|');

export default function NewPerson() {
  const account = useAccount();
  const matchesQuery = usePersonMatches();
  const create = useCreatePerson();
  const [givenNames, setGivenNames] = useState('');
  const [paternalSurname, setPaternalSurname] = useState('');
  const [maternalSurname, setMaternalSurname] = useState('');
  const [note, setNote] = useState('');
  const [phone, setPhone] = useState('');
  const [matches, setMatches] = useState<Matches | null>(null);
  const [decision, setDecision] = useState<Decision>(null);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});

  const key = nameKey(givenNames, paternalSurname, maternalSurname);
  // Matches belong to the name they were asked for: changing the name asks again.
  const current = matches?.key === key ? matches : null;
  const homonyms = current?.exact ?? [];
  const dirty = givenNames !== '' || paternalSurname !== '' || note !== '' || phone !== '';
  const guard = useDiscardGuard(dirty && !create.isSuccess);
  const proposed = account?.blockCode ?? null;

  const server = create.isError ? fieldErrors(create.error) : {};
  const noteError =
    create.isError &&
    isApiError(create.error) &&
    ['HOMONYM_WITHOUT_NOTE', 'DUPLICATE_DISTINGUISHING_NOTE'].includes(create.error.code)
      ? describeError(create.error).message
      : null;
  const general =
    create.isError && !noteError && Object.keys(server).length === 0
      ? describeError(create.error).message
      : matchesQuery.isError
        ? describeError(matchesQuery.error).message
        : null;
  const errorOf = (field: Field) =>
    errors[field] ?? server[field] ?? (field === 'distinguishingNote' ? noteError : null) ?? null;

  const chooseOther = () => {
    setDecision('other');
    if (note.trim() === '' && proposed) setNote(proposed);
  };

  const save = () => {
    const parsed = createPersonRequestSchema.safeParse({
      givenNames,
      paternalSurname,
      maternalSurname,
      distinguishingNote: note,
      phone,
    });
    if (!parsed.success) {
      const next: Partial<Record<Field, string>> = {};
      for (const issue of parsed.error.issues)
        next[String(issue.path[0]) as Field] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    if (!current) {
      // First the homonyms; the person decides before anything is registered.
      matchesQuery.mutate(parsed.data, {
        onSuccess: (found) => {
          setMatches({ key, ...found });
          setDecision(null);
          // Nobody alike: register at once. Otherwise show them; the next "Guardar" decides.
          if (found.exact.length === 0 && found.similar.length === 0) {
            create.mutate(parsed.data, { onSuccess: openCreated });
          }
        },
      });
      return;
    }
    if (decision !== null && decision !== 'other') {
      const id = decision.id;
      guard.leave(() => router.replace(`/common/people/${id}`));
      return;
    }
    if (homonyms.length > 0 && decision === null) return;
    if (homonyms.length > 0 && !parsed.data.distinguishingNote) {
      setErrors({ distinguishingNote: 'Escriba un distintivo para diferenciarla.' });
      return;
    }
    create.mutate(parsed.data, { onSuccess: openCreated });
  };

  const openCreated = ({ person }: { person: { id: number } }) =>
    guard.leave(() => router.replace(`/common/people/${person.id}`));

  const sameChosen = decision !== null && decision !== 'other';
  const busy = matchesQuery.isPending || create.isPending;

  return (
    <ScreenLayout
      footer={
        <Button
          label={sameChosen ? 'Abrir su ficha' : 'Guardar'}
          onPress={save}
          loading={busy}
          disabledReason={
            homonyms.length > 0 && decision === null ? 'Indique si es la misma persona.' : null
          }
        />
      }
    >
      <Header title="Registrar persona" onBack={() => router.back()} />

      <TextField
        label="Nombre(s)"
        required
        value={givenNames}
        onChangeText={setGivenNames}
        autoCapitalize="words"
        error={errorOf('givenNames')}
        maxLength={80}
      />
      <View style={styles.row}>
        <View style={styles.half}>
          <TextField
            label="Apellido paterno"
            required
            value={paternalSurname}
            onChangeText={setPaternalSurname}
            autoCapitalize="words"
            error={errorOf('paternalSurname')}
            maxLength={80}
          />
        </View>
        <View style={styles.half}>
          <TextField
            label="Apellido materno"
            value={maternalSurname}
            onChangeText={setMaternalSurname}
            autoCapitalize="words"
            error={errorOf('maternalSurname')}
            maxLength={80}
          />
        </View>
      </View>

      {homonyms.length > 0 ? (
        <SummaryCard>
          <AppText variant="bodyStrong">
            {homonyms.length === 1
              ? `Ya existe ${homonyms[0]?.fullName}. ¿Es la misma persona?`
              : `Ya existen ${homonyms.length} personas con ese nombre. ¿Es alguna de ellas?`}
          </AppText>
          {homonyms.map((person) => (
            <Radio
              key={person.id}
              label={homonyms.length === 1 ? 'Es la misma persona' : `Es ${personLine(person)}`}
              description={personLine(person) + ` · Folio ${person.folio}`}
              selected={decision !== null && decision !== 'other' && decision.id === person.id}
              onPress={() => setDecision(person)}
            />
          ))}
          <Radio label="Es otra persona" selected={decision === 'other'} onPress={chooseOther} />
        </SummaryCard>
      ) : null}

      {!sameChosen ? (
        <>
          <TextField
            label="Distintivo"
            required={homonyms.length > 0}
            value={note}
            onChangeText={setNote}
            help={
              homonyms.length > 0
                ? `${proposed ? `Propuesto: ${proposed}. ` : ''}Puede usar una referencia corta, ej. «de la tienda».`
                : 'Solo si hace falta distinguirla de alguien con el mismo nombre.'
            }
            error={errorOf('distinguishingNote')}
            maxLength={80}
          />
          <TextField
            label="Teléfono"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            error={errorOf('phone')}
            maxLength={20}
          />
        </>
      ) : (
        <Notice icon="info" title="No se registra a nadie: se abre la ficha de esa persona." />
      )}

      {current && current.similar.length > 0 ? (
        <View style={styles.similar}>
          <AppText variant="label" color={colors.textSecondary}>
            Nombres parecidos (revise que no sea un error de escritura)
          </AppText>
          <MenuGroup>
            {current.similar.map((person) => (
              <ListRow
                key={person.id}
                title={personLine(person)}
                subtitle={`Folio ${person.folio}`}
                onPress={() => router.push(`/common/people/${person.id}`)}
              />
            ))}
          </MenuGroup>
        </View>
      ) : null}

      {general ? <Notice title={general} /> : null}
      <AppText variant="caption" color={colors.textSecondary}>
        No se pide CURP: el nombre y el distintivo identifican a cada persona.
      </AppText>
      <DiscardChangesSheet guard={guard} />
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  half: { flexGrow: 1, flexBasis: 160 },
  similar: { gap: spacing.sm },
});
