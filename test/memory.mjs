/**
 * Memory safety: circuit breaker, cache release on dispose, and the row-wise
 * BMP adjacency scan (no full 46MB pixel matrix).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Workbench } from '../lib/engine.js'

let failed = 0
const check = (name, ok, detail = '') => {
  console.log((ok ? '  ok  ' : 'FAIL') + ' ' + name + (detail ? ' — ' + detail : ''))
  if (!ok) failed++
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eu4w-mem-'))
fs.mkdirSync(path.join(tmp, 'eu4', 'common'), { recursive: true })
fs.mkdirSync(path.join(tmp, 'mod', 'events'), { recursive: true })
fs.writeFileSync(path.join(tmp, 'mod', 'descriptor.mod'), 'name="x"\n', 'utf8')
const wb = new Workbench({ eu4Root: path.join(tmp, 'eu4'), modDir: path.join(tmp, 'mod'), eu4UserDir: '', statePath: path.join(tmp, 'state.json'), maxHeapMB: 16 })
wb.init()
check('base heap below test limit', wb.memoryMB() < 16, String(wb.memoryMB()))

// Allocate a large live object so the circuit breaker must trip.
const hold = Array.from({ length: 1_500_000 }, (_, i) => ({ i }))
let guarded = ''
try { wb.assertHeap('unit-test') } catch (e) { guarded = String(e.message || e) }
check('heap circuit breaker trips', guarded.includes('MEMORY_GUARD'), guarded)
hold.length = 0

wb.eventCatalog().catch(() => {})
wb.dispose()
check('dispose clears vanilla index', Array.isArray(wb.state.vanillaFiles) && wb.state.vanillaFiles.length === 0, JSON.stringify(wb.state.vanillaFiles?.length))
check('dispose is idempotent', (() => { try { wb.dispose(); return true } catch { return false } })())

const real = new Workbench()
real.init()
const island = await real.adjacentProvinces(333)
await Promise.all(Array.from({ length: 10 }, () => real.localisation()))
check('concurrent localisation stays bounded', real.memoryMB() < 512, String(real.memoryMB()))
check('island still has straits after row-wise scan', island.strait === 2 && island.items.some((item) => item.water === true), JSON.stringify(island.items))
check('adjacency build stays under 1GB', real.memoryMB() < 1024, String(real.memoryMB()))
real.dispose()

fs.rmSync(tmp, { recursive: true, force: true })
if (failed) process.exit(1)
