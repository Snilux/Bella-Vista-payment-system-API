import { Redirect } from 'expo-router';
import { ComponentGallery } from '../../src/dev/ComponentGallery.js';

/** Component gallery (M1): development only; in a release build it sends back to the start. */
export default function GalleryRoute() {
  if (!__DEV__) return <Redirect href="/" />;
  return <ComponentGallery />;
}
