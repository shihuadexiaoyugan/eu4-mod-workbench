import fs from 'node:fs';
import path from 'node:path';
import { Workbench, decodeLocalisationBuffer } from './lib/engine.js';
const wb = new Workbench();
wb.init();
for (const root of wb.localisationRoots()) {
  const dir = path.join(root, 'localisation');
  if (!fs.existsSync(dir)) continue;
  for (const rel of fs.readdirSync(dir, { recursive: true }).filter((f) => /\.yml$/i.test(f))) {
    const d = decodeLocalisationBuffer(fs.readFileSync(path.join(dir, rel)));
    if (d.invalid) console.log('unreadable:', path.join(root, rel).slice(-80), '| encoding', d.encoding, '| ctrl', (d.text.match(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g) || []).length);
  }
}
