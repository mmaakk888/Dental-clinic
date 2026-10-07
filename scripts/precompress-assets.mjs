import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, gzip, constants } from 'node:zlib';

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);
const assetsPath = path.resolve('dist/assets');
const names = (await readdir(assetsPath)).filter(name => /-[\w-]{8,}\.(?:js|css)$/.test(name));

// Compress public, fingerprinted build assets once, not on every page request.
// Never inspect or compress clinic records, backups, API responses or sources.
for (const name of names) {
  const file = path.join(assetsPath, name);
  const content = await readFile(file);
  if (content.length < 1024) continue;
  const [br, gz] = await Promise.all([
    brotli(content, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } }),
    gzipAsync(content, { level: 9 }),
  ]);
  await Promise.all([writeFile(`${file}.br`, br), writeFile(`${file}.gz`, gz)]);
}
console.log(`Prepared compressed public assets (${names.length} files checked).`);
