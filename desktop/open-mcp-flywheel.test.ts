import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenMcp } from './open-mcp';

const freePort = () => new Promise<number>(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); }); });

async function harness(t: test.TestContext, enabled: { on: boolean }) {
  const dir = await mkdtemp(join(tmpdir(), 'open-mcp-flywheel-'));
  const mcp = createOpenMcp({
    file: join(dir, 'open-mcp.json'), request: async () => ({}), reception: () => undefined, pauseReception: async () => {}, suspendReception: async () => {},
    confirmOwner: async () => {},
    flywheelEnabled: () => enabled.on,
    customers: async () => [{
      id: 'c-test-1', flywheelContactId: 'ct_01JBXYZ0000000000000000000', tags: ['未接触'], salesStage: { stage: 'PROPOSAL' },
      facts: [
        { field: 'city', value: '杭州', source: 'customer' },
        { field: 'phone', value: '13800138000', source: 'customer' },
        { field: 'wecomId', value: 'wmABCDEF', source: 'import' },
        { field: 'age', value: '35', source: 'customer', sensitive: true },
        { field: 'biz.b1.needs', value: '想要 AI 客服，电话 13900139000', source: 'customer' },
      ],
    }],
    receptionEvents: async () => [{ type: 'conversation.first_reply', at: '2026-11-02T10:00:00+08:00', latencySeconds: 8, by: 'ai', mode: 'auto' }],
  });
  t.after(async () => { await mcp.close(); await rm(dir, { recursive: true, force: true }).catch(() => {}); });
  await mcp.init();
  let s = await mcp.save({ enabled: true, port: await freePort() });
  s = await mcp.addClient({ label: 'CRM', tool: 'other' }); const crm = s.clients.at(-1)!.id;
  const keyOf = (as: string) => as === 'default' ? s.token : mcp.clientKey(as);
  const rpc = async (as: string, body: unknown) => (await (await fetch(s.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${keyOf(as)}` }, body: JSON.stringify(body) })).json()) as any;
  const names = async (as: string) => (await rpc(as, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools.map((x: any) => x.name) as string[];
  const call = async (as: string, name: string, args: Record<string, unknown>) => (await rpc(as, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } })).result;
  const grant = async () => { s = await mcp.save({ clientScope: { id: crm, configWrite: true } }); };
  return { crm, names, call, grant };
}

test('open interface: customers_get / reception_events_since only for a client with 「可以修改设置」, without identities, sensitive facts or text', async t => {
  const h = await harness(t, { on: true });
  // The shared default key and an ordinary client: not listed, refused.
  for (const as of ['default', h.crm]) {
    assert.equal((await h.names(as)).includes('customers_get'), false);
    const r = await h.call(as, 'customers_get', { id: 'c-test-1' });
    assert.equal(r.isError, true); assert.match(r.content[0].text, /可以修改设置/);
  }
  await h.grant();
  assert.ok((await h.names(h.crm)).includes('customers_get'));
  assert.ok((await h.names(h.crm)).includes('reception_events_since'));
  const r = await h.call(h.crm, 'customers_get', { id: 'c-test-1' });
  assert.equal(r.isError, undefined);
  const text = r.content[0].text as string;
  const out = JSON.parse(text);
  assert.equal(out.id, 'c-test-1');
  assert.equal(out.facts.city, '杭州');
  assert.equal(out.untouched, true);
  assert.equal(out.name, undefined);
  assert.doesNotMatch(text, /13800138000|13900139000|wmABCDEF|"age"|35/);
  assert.match(out.facts['biz.b1.needs'], /139\*\*\*\*9000/);
  const byContact = await h.call(h.crm, 'customers_get', { flywheelContactId: 'ct_01JBXYZ0000000000000000000' });
  assert.equal(JSON.parse(byContact.content[0].text).id, 'c-test-1');
  const ev = JSON.parse((await h.call(h.crm, 'reception_events_since', { since: '2026-11-01T00:00:00Z' })).content[0].text);
  assert.equal(ev.events[0].type, 'conversation.first_reply');
});

test('open interface: the flywheel tools are hidden and refused while the plugin is off', async t => {
  const enabled = { on: false };
  const h = await harness(t, enabled);
  await h.grant();
  assert.equal((await h.names(h.crm)).includes('customers_get'), false);
  const refused = await h.call(h.crm, 'customers_get', { id: 'c-test-1' });
  assert.match(JSON.stringify(refused), /没有打开/);
  assert.doesNotMatch(JSON.stringify(refused), /杭州/);
  enabled.on = true;
  assert.equal((await h.names(h.crm)).includes('customers_get'), true);
});
