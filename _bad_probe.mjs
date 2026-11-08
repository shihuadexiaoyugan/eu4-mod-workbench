import fs from 'node:fs';
import path from 'node:path';
import { Workbench, decodeLocalisationBuffer } from './lib/engine.js';
const wb = new Workbench();
wb.init();
const roots = wb.localisationRoots().map((r) => path.join(r, 'localisation'));
const bad = [];
for (const dir of roots) {
  if (!fs.existsSync(dir)) continue;
  const files = fs.readdirSync(dir, { recursive: true }).filter((f) => /\.yml$/i.test(f));
  for (const rel of files) {
    const full = path.join(dir, rel);
    try {
      const d = decodeLocalisationBuffer(fs.readFileSync(full));
      if (d.invalid) bad.push([path.basename(path.dirname(full)) + '/' + rel, d.encoding, d.text.length]);
    } catch {}
  }
}
console.log('unreadable', bad.length);
bad.filter(([f]) => !f.includes('2976470733')).slice(0, 20).forEach((x) => console.log(x));
