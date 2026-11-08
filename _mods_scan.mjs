import fs from 'node:fs';
import path from 'node:path';
import { decodeLocalisationBuffer, parseLocalisationText } from './lib/engine.js';
const modDir = path.join(process.env.USERPROFILE, 'Documents/Paradox Interactive/Europa Universalis IV/mod');
const rows = [];
for (const f of fs.readdirSync(modDir).filter((x) => x.endsWith('.mod'))) {
  const text = fs.readFileSync(path.join(modDir, f), 'utf8');
  const name = (/name\s*=\s*"([^"]*)"/.exec(text) || [])[1] || f;
  let p = (/path\s*=\s*"([^"]*)"/.exec(text) || [])[1] || '';
  if (!fs.existsSync(p)) continue;
  const loc = path.join(p, 'localisation');
  if (!fs.existsSync(loc)) continue;
  let cn = 0; let unreadable = 0; let files = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.yml$/i.test(e.name)) continue;
      files += 1;
      const d = decodeLocalisationBuffer(fs.readFileSync(full));
      if (d.invalid) { unreadable += 1; continue; }
      for (const [k, v] of Object.entries(parseLocalisationText(d.text))) {
        if (/^PROV\d+$/i.test(k) && /[\u4e00-\u9fff]/.test(v)) cn += 1;
      }
    }
  };
  walk(loc);
  rows.push({ name, files, cnProv: cn, unreadable });
}
rows.sort((a, b) => b.cnProv - a.cnProv);
console.table(rows);
