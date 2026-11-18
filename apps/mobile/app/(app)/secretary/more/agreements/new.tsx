// S-05 · Registrar acuerdo
import { type Agreement, createAgreementRequestSchema } from '@bella-vista/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { describeError, fieldErrors } from '../../../../../src/api/error-messages.js';
import { useAgreementOptions, useCreateAgreement } from '../../../../../src/api/useAgreements.js';
import { businessToday } from '../../../../../src/features/forms/business-date.js';
import {
  DiscardChangesSheet,
  useDiscardGuard,
} from '../../../../../src/features/forms/DiscardChangesSheet.js';
import {
  AGREEMENT_RESULT_LABELS,
  agreementLabel,
} from '../../../../../src/features/registry/agreement-view.js';
import {
  AppText,
  Button,
  colors,
  FieldMessage,
  Header,
  Notice,
  Radio,
  ScreenLayout,
  Select,
  spacing,
  TextField,
} from '../../../../../src/ui/index.js';

// A meeting agreement (Figma S-05; 3.2 §10.7): date, topic, result, votes and the minutes as a
// text reference, never a file (D-26). To correct an agreement, a new one mentions it.

type Field =
  | 'meetingDate'
  | 'topic'
  | 'result'
  | 'votesFor'
  | 'votesAgainst'
  | 'abstentions'
  | 'minutesReference';

const RESULTS: Agreement['result'][] = ['approved_by_majority', 'rejected'];

/** "" → null; anything else → the number (the schema rejects what is not a count). */
const count = (text: string): number | null => (text.trim() === '' ? null : Number(text.trim()));

export default function NewAgreement() {
  const create = useCreateAgreement();
  const previous = useAgreementOptions();
  const [meetingDate, setMeetingDate] = useState(businessToday());
  const [topic, setTopic] = useState('');
  const [result, setResult] = useState<Agreement['result'] | null>(null);
  const [votesFor, setVotesFor] = useState('');
  const [votesAgainst, setVotesAgainst] = useState('');
  const [abstentions, setAbstentions] = useState('');
  const [minutes, setMinutes] = useState('');
  const [correctsId, setCorrectsId] = useState<number | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const guard = useDiscardGuard((topic !== '' || minutes !== '') && !create.isSuccess);

  const server = create.isError ? fieldErrors(create.error) : {};
  const general =
    create.isError && Object.keys(server).length === 0 ? describeError(create.error).message : null;
  const errorOf = (field: Field) => errors[field] ?? server[field] ?? null;

  const submit = () => {
    const parsed = createAgreementRequestSchema.safeParse({
      meetingDate: meetingDate.trim(),
      topic,
      result: result ?? undefined,
      votesFor: count(votesFor),
      votesAgainst: count(votesAgainst),
      abstentions: count(abstentions),
      minutesReference: minutes,
      correctsId,
    });
    if (!parsed.success) {
      const next: Partial<Record<Field, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0]) as Field;
        next[field] ??= ['votesFor', 'votesAgainst', 'abstentions'].includes(field)
          ? 'Escriba un número entero.'
          : issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    create.mutate(parsed.data, { onSuccess: () => guard.leave(() => router.back()) });
  };

  return (
    <ScreenLayout
      footer={<Button label="Guardar acuerdo" onPress={submit} loading={create.isPending} />}
    >
      <Header title="Registrar acuerdo" onBack={() => router.back()} />
      <TextField
        label="Fecha de la junta"
        required
        value={meetingDate}
        onChangeText={setMeetingDate}
        help="AAAA-MM-DD."
        error={errorOf('meetingDate')}
        maxLength={10}
      />
      <TextField
        label="Tema"
        required
        value={topic}
        onChangeText={setTopic}
        example="Solicitud de toma ST-000013"
        error={errorOf('topic')}
        maxLength={300}
      />
      <View style={styles.group}>
        <AppText variant="label">Resultado *</AppText>
        {RESULTS.map((value) => (
          <Radio
            key={value}
            label={AGREEMENT_RESULT_LABELS[value]}
            selected={result === value}
            onPress={() => setResult(value)}
          />
        ))}
        {errorOf('result') ? <FieldMessage error={errorOf('result')} /> : null}
      </View>
      <View style={styles.votes}>
        {(
          [
            ['A favor', votesFor, setVotesFor, 'votesFor'],
            ['En contra', votesAgainst, setVotesAgainst, 'votesAgainst'],
            ['Abstenciones', abstentions, setAbstentions, 'abstentions'],
          ] as const
        ).map(([label, value, set, field]) => (
          <View key={field} style={styles.vote}>
            <TextField
              label={label}
              value={value}
              onChangeText={set}
              keyboardType="number-pad"
              error={errorOf(field)}
              maxLength={5}
            />
          </View>
        ))}
      </View>
      <TextField
        label="Referencia del acta"
        value={minutes}
        onChangeText={setMinutes}
        example="Acta 2026-19, foja 3"
        help="Solo texto: no se suben archivos."
        error={errorOf('minutesReference')}
        maxLength={200}
      />
      <Select
        label="Corrige a"
        options={[
          { value: 0, label: 'Ninguno' },
          ...(previous.data ?? []).map((agreement) => ({
            value: agreement.id,
            label: agreementLabel(agreement),
            description: agreement.topic,
          })),
        ]}
        value={correctsId ?? 0}
        onChange={(value) => setCorrectsId(value === 0 ? null : value)}
        help="Solo si este acuerdo corrige uno anterior."
      />
      {general ? <Notice title={general} /> : null}
      <AppText variant="caption" color={colors.textSecondary}>
        Un acuerdo no se edita después; se corrige con otro.
      </AppText>
      <DiscardChangesSheet guard={guard} />
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  votes: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  vote: { flexGrow: 1, flexBasis: 96 },
});
