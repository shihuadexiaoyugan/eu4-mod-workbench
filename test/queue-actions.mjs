/**
 * Queue action vocabulary regression: the AI payload uses `update`, the change
 * queue uses `modify`. The engine normalises at the boundary, so a mission or
 * GUI "update" can never fail with `invalid action: update`.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Workbench } from '../lib/engine.js'
import { buildBatchPrompt } from '../lib/batch.js'

let failed = 0
const check = (name, ok, detail = '') => {
  console.log((ok ? 'ok  ' : 'FAIL') + ' ' + name + (detail ? ' — ' + detail : ''))
  if (!ok) failed++
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eu4w-queue-'))
fs.mkdirSync(path.join(tmp, 'eu4'), { recursive: true })
fs.mkdirSync(path.join(tmp, 'mod'), { recursive: true })
const wb = new Workbench({
  eu4Root: path.join(tmp, 'eu4'),
  modDir: path.join(tmp, 'mod'),
  eu4UserDir: '',
  statePath: path.join(tmp, 'state.json'),
})
wb.init()

/* The exact payload the mission tree sends when an existing node is edited. */
const mission = wb.addChange({
  targetType: 'mission',
  action: 'update',
  targetId: 'missions/boh.txt',
  targetFile: 'missions/boh.txt',
  data: { file: 'missions/boh.txt', nodes: [{ id: 'boh_1', required: [], conditions: [], rewards: [] }] },
})
check('mission update accepted', Boolean(mission?.id))
check('update normalised to modify', mission?.action === 'modify', mission?.action)
check('queue stores modify', wb.listChanges().at(-1)?.action === 'modify', wb.listChanges().at(-1)?.action)

/* The GUI panel's "更新" option follows the same path. */
const gui = wb.addChange({
  targetType: 'gui',
  action: 'update',
  targetId: 'zeal_button',
  data: { name: 'zeal_button', imagePath: 'gfx/interface/x.dds' },
})
check('gui update accepted', gui?.action === 'modify', gui?.action)

/* Real actions survive untouched, including delete. */
const deleted = wb.addChange({
  targetType: 'event',
  action: 'delete',
  targetId: 'ashes.blockade.1',
  targetFile: 'events/hussite_blockade.txt',
  data: { id: 'ashes.blockade.1' },
})
check('delete preserved', deleted?.action === 'delete', deleted?.action)
const modified = wb.addChange({
  targetType: 'national_ideas',
  action: 'modify',
  targetId: 'BOH',
  data: { tag: 'BOH', traditions: [], ambition: {}, ideas: [] },
})
check('modify preserved', modified?.action === 'modify', modified?.action)

/* Anything else must still be rejected, with the offending value. */
let rejected = false
try {
  wb.addChange({ targetType: 'mission', action: 'rename', targetId: 'm', data: {} })
} catch (error) {
  rejected = /invalid action: rename/.test(String(error.message || ''))
}
check('unknown action still rejected', rejected)

/* Dedupe still keys on targetType + targetId after normalisation. */
wb.addChange({
  targetType: 'mission',
  action: 'modify',
  targetId: 'missions/boh.txt',
  targetFile: 'missions/boh.txt',
  data: { file: 'missions/boh.txt', nodes: [{ id: 'boh_2', required: [], conditions: [], rewards: [] }] },
})
const missionItems = wb.listChanges().filter((item) => item.targetType === 'mission' && item.targetId === 'missions/boh.txt')
check('same target replaced', missionItems.length === 1, String(missionItems.length))
check('replacement is the newer node', missionItems[0]?.data?.nodes?.[0]?.id === 'boh_2', missionItems[0]?.data?.nodes?.[0]?.id)

/* The emitted prompt must never contain the AI-only vocabulary. */
const built = buildBatchPrompt(wb.listChanges())
check('prompt has no action: update', !/action:\s*update\b/.test(built.prompt))
check('prompt describes the mission task', built.prompt.includes('修改任务树'))
check('payload action values are queue-safe', built.payload.changes.every((item) => ['create', 'modify', 'delete'].includes(item.action)))

fs.rmSync(tmp, { recursive: true, force: true })

if (failed) process.exit(1)
