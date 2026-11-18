import { router } from 'expo-router';
import { useState } from 'react';
import {
  REQUEST_CONFIGS,
  REQUEST_TYPES,
  type RequestType,
} from '../features/approvals/approval-types.js';
import { AppText, Button, colors, Header, ScreenLayout, Select, TextField } from '../ui/index.js';

// Development only (M4): opens G-11 with any request type and record id, to try it against the
// API before the screens that open it exist (G-04 and G-05 in M6, T-07 in M7). It needs a
// session whose role may send that type (the screen says so otherwise).

export function ApprovalRequestLauncher() {
  const [type, setType] = useState<RequestType>('payment_cancellation');
  const [id, setId] = useState('');
  const [subject, setSubject] = useState('');
  const valid = /^\d+$/.test(id) && Number(id) > 0;

  return (
    <ScreenLayout
      footer={
        <Button
          label="Abrir G-11"
          disabledReason={valid ? null : 'Escriba el id del registro.'}
          onPress={() =>
            router.push({
              pathname: '/common/approval-request',
              params: { type, id, ...(subject.trim() ? { subject: subject.trim() } : {}) },
            })
          }
        />
      }
    >
      <Header title="Probar G-11" subtitle="Solo en desarrollo" onBack={() => router.back()} />
      <Select
        label="Tipo"
        required
        options={REQUEST_TYPES.map((value) => ({
          value,
          label: REQUEST_CONFIGS[value].title,
          description: value,
        }))}
        value={type}
        onChange={setType}
      />
      <TextField
        label="Id del registro"
        required
        value={id}
        onChangeText={setId}
        keyboardType="number-pad"
        help="Familia (unidad), pago o gasto, según el tipo."
      />
      <TextField label="Línea bajo el título" value={subject} onChangeText={setSubject} />
      <AppText variant="caption" color={colors.textSecondary}>
        Use una cuenta cuyo cargo pueda enviar ese tipo de solicitud.
      </AppText>
    </ScreenLayout>
  );
}
