import * as Clipboard from 'expo-clipboard';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText, Button, ConfirmSheet, colors, layout, radii, spacing } from '../../ui/index.js';

// The temporary password of A-02 and of "Restablecer contraseña" in A-03 (3.2 §10.8): shown
// once, in the warm card of the Figma capture, with "Copiar". While it is on screen the phone
// blocks screenshots and screen recording (Android; iOS only partly). The password lives only in
// the state of the screen that shows this card; when the card goes away, a copied password is
// also wiped from the clipboard.

export type TemporaryPasswordCardProps = {
  password: string;
  username: string;
};

export function TemporaryPasswordCard({ password, username }: TemporaryPasswordCardProps) {
  usePreventScreenCapture();
  const [copied, setCopied] = useState(false);
  const copiedRef = useRef(false);

  useEffect(
    () => () => {
      if (copiedRef.current) void Clipboard.setStringAsync('').catch(() => undefined);
    },
    [],
  );

  const copy = async () => {
    await Clipboard.setStringAsync(password);
    copiedRef.current = true;
    setCopied(true);
  };

  return (
    <View style={styles.card}>
      <AppText variant="label" color={colors.textSecondary}>
        Contraseña temporal de {username}
      </AppText>
      <AppText
        variant="display"
        selectable={false}
        accessibilityLabel={`Contraseña temporal: ${password}`}
      >
        {password}
      </AppText>
      <AppText variant="caption" color={colors.textSecondary}>
        Se muestra una sola vez. Entréguela en persona; deberá cambiarla al entrar.
      </AppText>
      <Button
        label={copied ? 'Copiada' : 'Copiar'}
        variant="secondary"
        onPress={() => void copy()}
      />
      {copied ? (
        <AppText variant="caption" color={colors.textSecondary}>
          Al salir de esta pantalla se borra del portapapeles.
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceWarm,
    borderRadius: radii.card,
    padding: layout.cardPadding,
    gap: spacing.md,
  },
});

/** "¿Ya la anotó?" before leaving a screen that shows a temporary password (useLeaveGuard). */
export function LeavePasswordSheet({
  visible,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmSheet
      visible={visible}
      title="¿Ya anotó la contraseña?"
      confirmLabel="Sí, salir"
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <AppText variant="body">
        Al salir ya no podrá volver a verla. Si se pierde, restablézcala desde el detalle de la
        cuenta.
      </AppText>
    </ConfirmSheet>
  );
}
