import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { fontFamilies } from './typography.js';

/** Inter in the four weights of 2.4 §3, keyed by the family names the text styles use. */
export const fontAssets = {
  [fontFamilies.regular]: Inter_400Regular,
  [fontFamilies.medium]: Inter_500Medium,
  [fontFamilies.semibold]: Inter_600SemiBold,
  [fontFamilies.bold]: Inter_700Bold,
};
