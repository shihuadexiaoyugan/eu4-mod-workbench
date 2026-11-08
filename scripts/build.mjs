/**
 * Compile the erasable-TypeScript sources to plain ESM for the DSH Loader.
 * Node 24 ships module.stripTypeScriptTypes(); no external toolchain is needed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = ['lib/ai.ts', 'lib/nl2code.ts', 'lib/batch.ts', 'lib/cultures-data.ts', 'lib/eu4-dictionary.ts', 'lib/ui-locales.ts', 'lib/engine.ts', 'lib/server.ts', 'index.ts'].filter((f) => fs.existsSync(path.join(root, f)));
for (const rel of files) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const out = stripTypeScriptTypes(src, { mode: 'strip', sourceMap: false });
  const dest = path.join(root, rel.replace(/\.ts$/, '.js'));
  fs.writeFileSync(dest, out, 'utf8');
  console.log(`built ${rel} -> ${path.relative(root, dest)}`);
}
