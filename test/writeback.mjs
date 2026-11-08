/**
 * Write-back / mod-directory guards: descriptor.mod validation, absolute target
 * paths, read-back verification (found / missing / delete) and the batch prompt
 * rules for delete + read-back.
 */
import http from 'node:http'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Workbench } from '../lib/engine.js'
import { createHandler } from '../lib/server.js'
import { buildBatchPrompt } from '../lib/batch.js'

const here = path.dirname(fileURLToPath(import.meta.url))
let failed = 0
const check = (name, ok, detail = '') => {
  console.log((ok ? '  ok  ' : 'FAIL') + ' ' + name + (detail ? ' — ' + detail : ''))
  if (!ok) failed++
}

/* ------------------------------ fixtures ------------------------------ */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eu4w-writeback-'))
fs.mkdirSync(path.join(tmp, 'eu4', 'common'), { recursive: true })
fs.mkdirSync(path.join(tmp, 'mod', 'events'), { recursive: true })
fs.writeFileSync(path.join(tmp, 'mod', 'descriptor.mod'), 'name="Test Mod"\n', 'utf8')
fs.writeFileSync(path.join(tmp, 'mod', 'events', 'x.txt'), 'namespace = test\ncountry_event = { id = test.1 title = test.1.t }\n', 'utf8')
fs.mkdirSync(path.join(tmp, 'badmod', 'events'), { recursive: true })

const wb = new Workbench({ eu4Root: path.join(tmp, 'eu4'), modDir: path.join(tmp, 'mod'), eu4UserDir: '', statePath: path.join(tmp, 'state.json') })
wb.init()
const bad = new Workbench({ eu4Root: path.join(tmp, 'eu4'), modDir: path.join(tmp, 'badmod'), eu4UserDir: '', statePath: path.join(tmp, 'state2.json') })
bad.init()

/* --------------------------- directory guard --------------------------- */
const verify = wb.verifyModDirectory()
check('valid mod directory', verify.ok === true && verify.descriptor.endsWith('descriptor.mod'), JSON.stringify(verify))
const badVerify = bad.verifyModDirectory()
check('invalid mod directory rejected', badVerify.ok === false && badVerify.message.includes('descriptor.mod'), JSON.stringify(badVerify))
check('absolute mod path', wb.absoluteModPath('events/x.txt') === path.join(tmp, 'mod', 'events', 'x.txt'), wb.absoluteModPath('events/x.txt'))
check('invalid readback blocked', (await bad.readBack({ targetType: 'event', targetId: 'test.1', targetFile: 'events/x.txt' })).ok === false)

/* ------------------------------ read-back ------------------------------ */
const found = await wb.readBack({ targetType: 'event', targetId: 'test.1', targetFile: 'events/x.txt' })
check('readback finds event', found.ok === true && found.found === true && found.size > 0, JSON.stringify(found))
check('readback absolute path', found.absolute === path.join(tmp, 'mod', 'events', 'x.txt'), found.absolute)
check('readback message', found.message.includes('test.1') && found.message.includes('bytes'), found.message)
const missing = await wb.readBack({ targetType: 'event', targetId: 'test.404', targetFile: 'events/x.txt' })
check('readback missing id', missing.ok === false && missing.found === false && missing.exists === true)
const deleteExisting = await wb.readBack({ targetType: 'event', targetId: 'test.1', targetFile: 'events/x.txt', action: 'delete' })
check('delete readback still present -> error', deleteExisting.ok === false && deleteExisting.found === true)
const deleteMissing = await wb.readBack({ targetType: 'event', targetId: 'test.404', targetFile: 'events/x.txt', action: 'delete' })
check('delete readback absent -> ok', deleteMissing.ok === true)
const noFile = await wb.readBack({ targetType: 'event', targetId: 'x', targetFile: 'events/none.txt' })
check('readback missing file', noFile.ok === false && noFile.exists === false)

/* ---------------------- node vs whole-file deletion ---------------------- */
fs.writeFileSync(path.join(tmp, 'mod', 'events', 'del.txt'), 'namespace = del\ncountry_event = { id = del.1 title = del.1.t }\ncountry_event = { id = del.2 title = del.2.t }\n', 'utf8')
const nodeStill = await wb.readBack({ targetType: 'event', targetId: 'del.1', targetFile: 'events/del.txt', action: 'delete' })
check('delete node still present -> fail', nodeStill.ok === false && nodeStill.operation === 'delete-node' && nodeStill.message.includes('仍存在'), JSON.stringify(nodeStill))
fs.writeFileSync(path.join(tmp, 'mod', 'events', 'del.txt'), 'namespace = del\ncountry_event = { id = del.2 title = del.2.t }\n', 'utf8')
const nodeGone = await wb.readBack({ targetType: 'event', targetId: 'del.1', targetFile: 'events/del.txt', action: 'delete' })
check('delete node removed -> ok', nodeGone.ok === true && nodeGone.operation === 'delete-node' && nodeGone.message.includes('已成功移除'), JSON.stringify(nodeGone))

const fileStill = await wb.readBack({ targetType: 'event', targetId: 'events/del.txt', targetFile: 'events/del.txt', action: 'delete', deleteFile: true })
check('delete file still present -> fail', fileStill.ok === false && fileStill.operation === 'delete-file' && fileStill.message.includes('文件仍存在'), JSON.stringify(fileStill))
fs.unlinkSync(path.join(tmp, 'mod', 'events', 'del.txt'))
const fileGone = await wb.readBack({ targetType: 'event', targetId: 'events/del.txt', targetFile: 'events/del.txt', action: 'delete', deleteFile: true })
check('delete file removed -> ok', fileGone.ok === true && fileGone.operation === 'delete-file' && fileGone.message.includes('文件已成功删除'), JSON.stringify(fileGone))

fs.mkdirSync(path.join(tmp, 'mod', 'missions'), { recursive: true })
fs.writeFileSync(path.join(tmp, 'mod', 'missions', 'm.txt'), 'm_tree = {\n\ta = {\n\t\tslot = 1\n\t}\n\tb = {\n\t\tslot = 1\n\t}\n}\n', 'utf8')
const nodesStill = await wb.readBack({ targetType: 'mission', targetId: 'missions/m.txt', targetFile: 'missions/m.txt', action: 'modify', removedNodeIds: ['a'] })
check('removed nodes still present -> fail', nodesStill.ok === false && nodesStill.operation === 'delete-nodes' && nodesStill.message.includes('仍存在'), JSON.stringify(nodesStill))
fs.writeFileSync(path.join(tmp, 'mod', 'missions', 'm.txt'), 'm_tree = {\n\tb = {\n\t\tslot = 1\n\t}\n}\n', 'utf8')
const nodesGone = await wb.readBack({ targetType: 'mission', targetId: 'missions/m.txt', targetFile: 'missions/m.txt', action: 'modify', removedNodeIds: ['a'] })
check('removed nodes gone -> ok', nodesGone.ok === true && nodesGone.operation === 'delete-nodes' && nodesGone.message.includes('已成功移除'), JSON.stringify(nodesGone))

/* ---------------------- province owner/controller ---------------------- */
fs.mkdirSync(path.join(tmp, 'mod', 'history', 'provinces'), { recursive: true });
const provFile = path.join(tmp, 'mod', 'history', 'provinces', '265 - Test.txt');
fs.writeFileSync(provFile, '1437.1.1 = {\n\towner = MVA\n\tcontroller = BOH\n}\n', 'utf8');
const provMismatch = await wb.readBack({ targetType: 'province_history', targetId: '265', targetFile: 'history/provinces/265 - Test.txt', action: 'modify', owner: 'MVA' });
check('province owner/controller mismatch warns', provMismatch.ok === true && provMismatch.province.mismatch === true && provMismatch.province.inDateBlock === true && provMismatch.province.ownerMatches === true, JSON.stringify(provMismatch.province))
fs.writeFileSync(provFile, '1437.1.1 = {\n\towner = MVA\n\tcontroller = MVA\n}\n', 'utf8');
const provOk = await wb.readBack({ targetType: 'province_history', targetId: '265', targetFile: 'history/provinces/265 - Test.txt', action: 'modify', owner: 'MVA' });
check('province matching controller ok', provOk.ok === true && provOk.province.mismatch === false && provOk.province.inDateBlock === true, JSON.stringify(provOk.province))
fs.writeFileSync(provFile, 'owner = MVA\ncontroller = MVA\n', 'utf8');
const provNoBlock = await wb.readBack({ targetType: 'province_history', targetId: '265', targetFile: 'history/provinces/265 - Test.txt', action: 'modify', owner: 'MVA' });
check('province outside date block warns', provNoBlock.province.inDateBlock === false, JSON.stringify(provNoBlock.province))
const provBatch = buildBatchPrompt([{
  id: 'qp', targetType: 'province_history', action: 'modify', targetId: '265', targetFile: 'history/provinces/265 - Test.txt',
  data: { id: 265, owner: 'MVA', controller: 'BOH', base_tax: 5 },
}], { modRoot: path.join(tmp, 'mod'), eu4Root: path.join(tmp, 'eu4'), modVerified: true, startDate: '1437.1.1' })
check('province prompt date block + sync', provBatch.prompt.includes('1437.1.1 = { owner = X controller = X') && provBatch.prompt.includes('value一致') === false && provBatch.prompt.includes('必须同时写且值一致'), '')
check('province payload controller synced', provBatch.payload.changes[0].data.controller === 'MVA', JSON.stringify(provBatch.payload.changes[0].data))

/* ---------------------- namespace + startup trigger ---------------------- */
fs.writeFileSync(path.join(tmp, 'mod', 'events', 'nons.txt'), 'country_event = { id = ns.1 title = ns.1.t }\n', 'utf8')
const noNs = await wb.readBack({ targetType: 'event', targetId: 'ns.1', targetFile: 'events/nons.txt', action: 'create' })
check('missing namespace fails', noNs.ok === false && noNs.namespaceOk === false, JSON.stringify({ namespace: noNs.namespace, expected: noNs.namespaceExpected }))
fs.writeFileSync(path.join(tmp, 'mod', 'events', 'nons.txt'), 'namespace = ns\ncountry_event = { id = ns.1 title = ns.1.t }\n', 'utf8')
const withNs = await wb.readBack({ targetType: 'event', targetId: 'ns.1', targetFile: 'events/nons.txt', action: 'create' })
check('namespace matches -> ok', withNs.ok === true && withNs.namespaceOk === true && withNs.namespace === 'ns', JSON.stringify(withNs.namespace))

fs.mkdirSync(path.join(tmp, 'mod', 'history', 'countries'), { recursive: true })
const noTrigger = await wb.readBack({ targetType: 'event', targetId: 'test.1', targetFile: 'events/x.txt', action: 'create', triggerMode: 'startup', historyTag: 'TBO', bindDate: '1437.1.1' })
check('startup without history bind fails', noTrigger.ok === false && noTrigger.trigger && noTrigger.trigger.ok === false, JSON.stringify(noTrigger.trigger))
fs.writeFileSync(path.join(tmp, 'mod', 'history', 'countries', 'TBO - Tabor.txt'), '1437.1.1 = { country_event = { id = test.1 days = 0 } }\n', 'utf8')
const historyOnly = await wb.readBack({ targetType: 'event', targetId: 'test.1', targetFile: 'events/x.txt', action: 'create', triggerMode: 'startup', historyTag: 'TBO', bindDate: '1437.1.1' })
check('history only lacks on_startup -> fail', historyOnly.ok === false && historyOnly.trigger.onAction && historyOnly.trigger.onAction.bound === false, JSON.stringify(historyOnly.trigger.onAction))
fs.mkdirSync(path.join(tmp, 'mod', 'common', 'on_actions'), { recursive: true })
fs.writeFileSync(path.join(tmp, 'mod', 'common', 'on_actions', 'zz_eu4_workbench_on_actions.txt'), 'on_startup = {\n\teffect = {\n\t\tif = {\n\t\t\tlimit = { exists = TBO }\n\t\t\tTBO = { country_event = { id = test.1 days = 1 } }\n\t\t}\n\t}\n}\n', 'utf8')
const withTrigger = await wb.readBack({ targetType: 'event', targetId: 'test.1', targetFile: 'events/x.txt', action: 'create', triggerMode: 'startup', historyTag: 'TBO', bindDate: '1437.1.1' })
check('startup history + on_startup -> ok', withTrigger.ok === true && withTrigger.trigger.ok === true && withTrigger.trigger.alreadyBound === true && withTrigger.trigger.onAction.bound === true, JSON.stringify(withTrigger.trigger))

/* ------------------------------ batch prompt ------------------------------ */
const batch = buildBatchPrompt([{
  id: 'q', targetType: 'event', action: 'delete', targetId: 'test.1', targetFile: 'events/x.txt',
  data: { id: 'test.1', file: 'events/x.txt' },
}], { modRoot: path.join(tmp, 'mod'), eu4Root: path.join(tmp, 'eu4'), modVerified: true })
check('batch path contract', batch.prompt.includes('[Path contract / 路径契约]') && batch.prompt.includes(path.join(tmp, 'mod')))
check('batch verified line', batch.prompt.includes('descriptor.mod found'))
check('batch read-first rule', batch.prompt.includes('修改/删除前必须先 read 目标文件'))
check('batch full-override rule', batch.prompt.includes('完整复制到 Mod 的同路径'))
check('batch readback rule', batch.prompt.includes('eu4_readback'))
const batchEventModify = buildBatchPrompt([{
  id: 'q4', targetType: 'event', action: 'modify', targetId: 'test.1', targetFile: 'events/x.txt',
  data: { id: 'test.1', file: 'events/x.txt', triggerMode: 'startup', targetTag: 'TBO', bindDate: '1437.1.1', options: [] },
}], { modRoot: path.join(tmp, 'mod'), eu4Root: path.join(tmp, 'eu4'), modVerified: true })
check('batch namespace rule', batchEventModify.prompt.includes('namespace = <ID 前缀>') && batchEventModify.prompt.includes('add_namespace'))
check('batch trigger rule', batchEventModify.prompt.includes('is_triggered_only') && batchEventModify.prompt.includes('history/on_action/effect'))
check('batch on_startup fallback', batchEventModify.prompt.includes('on_startup = {') && batchEventModify.prompt.includes('zz_eu4_workbench_on_actions.txt'))
const batchFileDelete = buildBatchPrompt([{
  id: 'q2', targetType: 'event', action: 'delete', targetId: 'events/x.txt', targetFile: 'events/x.txt',
  data: { id: 'events/x.txt', file: 'events/x.txt', deleteFile: true },
}], { modRoot: path.join(tmp, 'mod'), eu4Root: path.join(tmp, 'eu4'), modVerified: true })
check('batch file delete instruction', batchFileDelete.prompt.includes('删除整个文件') && batchFileDelete.prompt.includes('直接删除'), '')
const batchMissionDelete = buildBatchPrompt([{
  id: 'q3', targetType: 'mission', action: 'modify', targetId: 'missions/m.txt', targetFile: 'missions/m.txt',
  data: { file: 'missions/m.txt', nodes: [{ id: 'b' }], removedNodeIds: ['a'] },
}], { modRoot: path.join(tmp, 'mod'), eu4Root: path.join(tmp, 'eu4'), modVerified: true })
check('batch mission node delete', batchMissionDelete.prompt.includes('删除以下任务节点：a') && batchMissionDelete.prompt.includes('不要整文件覆盖'), '')

/* ------------------------------- server ------------------------------- */
const wbBad = new Workbench({ eu4Root: path.join(tmp, 'eu4'), modDir: path.join(tmp, 'badmod'), eu4UserDir: '', statePath: path.join(tmp, 'state3.json') })
wbBad.init()
wbBad.addChange({ targetType: 'event', action: 'create', targetId: 'x.1', targetFile: 'events/x.txt', data: { id: 'x.1' } })
const server = http.createServer(createHandler(wbBad))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/eu4-workbench`
const post = async (p, body) => (await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-eu4-workbench': '1' }, body: JSON.stringify(body || {}) })).json()
const blocked = await post('/api/queue/build', {})
check('server blocks invalid mod', blocked.ok === false && String(blocked.error).includes('descriptor.mod'), JSON.stringify(blocked).slice(0, 160))
const verified = await (await fetch(base + '/api/mod/verify')).json()
check('mod verify api', verified.data.ok === false)
server.close()

/* preview absolute path (valid mod) */
const server2 = http.createServer(createHandler(wb))
await new Promise((resolve) => server2.listen(0, '127.0.0.1', resolve))
const base2 = `http://127.0.0.1:${server2.address().port}/eu4-workbench`
const post2 = async (p, body) => (await fetch(base2 + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-eu4-workbench': '1' }, body: JSON.stringify(body || {}) })).json()
const preview = await post2('/api/ai/preview', { kind: 'event', data: { file: 'events/x.txt', id: 'test.1', title: 'T', desc: 'D', triggerMode: 'normal', conditions: [{ type: 'tag', op: '=', value: 'TBO' }], options: [] } })
check('preview absolute path', preview.data.absolutePath === path.join(tmp, 'mod', 'events', 'x.txt'), String(preview.data.absolutePath))
check('preview mod verified', preview.data.modVerified === true)
server2.close()

/* ------------------------------ client UI ------------------------------ */
const candidates = []
if (process.env.DSH_PROFILE_DIR) candidates.push(path.join(process.env.DSH_PROFILE_DIR, 'package.json'))
candidates.push(path.join(here, '..', 'package.json'))
candidates.push(path.join(process.env.USERPROFILE || '', '.dsh', 'profiles', 'desktop', 'package.json'))
let React = null
let ReactDOMServer = null
for (const manifest of candidates) {
  if (!manifest || !existsSync(manifest)) continue
  try {
    const req = createRequire(manifest)
    React = req('react')
    ReactDOMServer = req('react-dom/server')
    break
  } catch { React = null }
}
if (React) {
  let factory = null
  globalThis.window = { __ModuleLoader__: { load(definition) { factory = definition.factory } } }
  await import('../client.js')
  const plugin = factory((name) => {
    if (name === 'react') return React
    throw new Error('unexpected require: ' + name)
  })
  const internals = plugin.testInternals
  const batchHtml = internals.renderTabForTest('BatchTab', React, ReactDOMServer)
  check('ui readback button', batchHtml.includes('回读验证'))
  check('ui path check button', batchHtml.includes('校验写入路径'))
  check('ui delete node label', internals.readbackLabel({ operation: 'delete-node', ok: true }).text === '操作类型：删除节点 → 验证结果：节点已成功移除')
  check('ui delete file label', internals.readbackLabel({ operation: 'delete-file', ok: false }).text === '操作类型：删除文件 → 验证结果：删除失败，文件仍存在')
  check('ui modify label', internals.readbackLabel({ operation: 'modify', ok: true }).text === '操作类型：修改 → 验证结果：已写入/已找到')
  check('ui found but trigger missing label', internals.readbackLabel({ operation: 'modify', ok: false, found: true, namespaceExpected: 'hus_event', namespaceOk: true, trigger: { expected: true, ok: false, history: { ok: true }, onAction: { bound: false } } }).text.includes('已找到（开局引线未绑定）'))
  check('ui delete label has no size', !internals.readbackLabel({ operation: 'delete-node', ok: true, size: 2063 }).text.includes('2063'))
  check('ui province sync helper', internals.syncProvinceController({ owner: 'MVA', controller: 'BOH' }).controller === 'MVA')
  check('ui readback namespace/trigger', (() => {
    const text = internals.readbackLabel({
      operation: 'create', ok: true,
      namespaceExpected: 'hus_event', namespaceOk: true, namespace: 'hus_event',
      trigger: { expected: true, ok: true, history: { ok: true }, onAction: { bound: true } },
    }).text
    return text.includes('namespace ✅') && text.includes('开局引线 ✅') && text.includes('on_startup ✅')
  })())
} else {
  console.log('skipped client checks: react not resolvable')
}

fs.rmSync(tmp, { recursive: true, force: true })
if (failed) process.exit(1)
