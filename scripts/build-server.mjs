import { build } from 'esbuild';

// The web dist is deployable static content. Server code/secrets never belong there.
await build({ entryPoints: ['server.ts'], bundle: true, platform: 'node', format: 'cjs',
  packages: 'external', sourcemap: false, outfile: 'build/server.cjs', target: 'node22' });
