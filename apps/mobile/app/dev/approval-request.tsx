import { Redirect } from 'expo-router';
import { ApprovalRequestLauncher } from '../../src/dev/ApprovalRequestLauncher.js';

/** G-11 launcher (M4): development only, until G-04, G-05 and T-07 open G-11 (M6, M7). */
export default function ApprovalRequestLauncherRoute() {
  if (!__DEV__) return <Redirect href="/" />;
  return <ApprovalRequestLauncher />;
}
