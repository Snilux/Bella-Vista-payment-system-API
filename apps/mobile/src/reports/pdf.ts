import { printToFileAsync } from 'expo-print';
import { shareAsync } from 'expo-sharing';

// HTML → PDF on the phone and share it (3.2 §11.1; D-26): the file stays on the device (the
// system's share sheet saves or sends it); nothing is uploaded to the server.

export async function exportPdf(html: string, title: string): Promise<void> {
  const { uri } = await printToFileAsync({ html });
  await shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: title });
}
