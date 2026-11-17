// Metro for the pnpm monorepo (3.2 §1 and M1). Expo detects the workspace and watches
// packages/shared on its own; two things are added here:
// - the "development" export condition, so @bella-vista/shared is bundled from its TypeScript
//   sources (src/) instead of dist/, like the API does with tsx;
// - relative imports written with ".js" (NodeNext style, CLAUDE.md) resolve to the .ts/.tsx file.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const sourceRoots = [path.join(__dirname, 'app'), path.join(__dirname, 'src')].concat(
  path.resolve(__dirname, '../../packages/shared/src'),
);
const isSource = (file) => sourceRoots.some((root) => file.startsWith(root + path.sep));

config.resolver.unstable_conditionNames = [
  ...(config.resolver.unstable_conditionNames ?? ['require', 'import']),
  'development',
];

const upstreamResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstreamResolve ?? context.resolveRequest;
  if (
    moduleName.startsWith('.') &&
    moduleName.endsWith('.js') &&
    isSource(context.originModulePath)
  ) {
    return resolve(context, moduleName.slice(0, -'.js'.length), platform);
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
