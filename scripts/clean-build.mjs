import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const name of ['dist', 'build']) {
  const target = path.resolve(projectRoot, name);
  if (path.dirname(target) !== projectRoot) throw new Error('Build target is outside the project');
  await rm(target, { recursive: true, force: true });
}
