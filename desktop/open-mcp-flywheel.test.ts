import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenMcp } from './open-mcp';

test('open-mcp exposes customers_get and reception_events_since when deps are provided', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'open-mcp-flywheel-'));
  const file = join(dir, 'open-mcp.json');

  const mcp = createOpenMcp({
    file,
    request: async () => ({}),
    reception: () => undefined,
    pauseReception: async () => {},
    suspendReception: async () => {},
    customers: async () => [
      {
        id: 'c-test-1',
        name: '张三',
        flywheelContactId: 'fw-c-1',
        facts: [
          { field: 'city', value: '杭州', sensitive: false },
          { field: 'password', value: 'secret123', sensitive: true },
        ],
        salesStage: { stage: '已签约' },
      },
    ],
    receptionEvents: async (since, limit) => [
      {
        type: 'conversation.first_reply',
        at: '2026-11-02T10:00:00Z',
        latencySeconds: 8,
      },
    ],
  });

  t.after(async () => {
    await mcp.close();
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  await mcp.init();
  await mcp.save({ enabled: true, port: 18899 });
  const s = mcp.state();
  assert.equal(s.listening, true);

  const call = async (body: unknown) => {
    const r = await fetch(s.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${s.token}`,
      },
      body: JSON.stringify(body),
    });
    return (await r.json()) as any;
  };

  const listRes = await call({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
  });

  assert.equal(listRes.error, undefined);
  const toolNames = listRes.result.tools.map((x: any) => x.name);

  assert.ok(toolNames.includes('customers_get'));
  assert.ok(toolNames.includes('reception_events_since'));

  // Call customers_get
  const callRes = await call({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'customers_get',
      arguments: { id: 'c-test-1' },
    },
  });

  assert.equal(callRes.error, undefined);
  const content = JSON.parse(callRes.result.content[0].text);
  assert.equal(content.id, 'c-test-1');
  assert.equal(content.name, '张三');
  assert.equal(content.flywheelContactId, 'fw-c-1');
  assert.equal(content.facts.some((f: any) => f.field === 'password'), false);
  assert.equal(content.facts.some((f: any) => f.field === 'city'), true);

  // Call reception_events_since
  const evRes = await call({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'reception_events_since',
      arguments: { since: '2026-11-01T00:00:00Z' },
    },
  });

  assert.equal(evRes.error, undefined);
  const evContent = JSON.parse(evRes.result.content[0].text);
  assert.equal(evContent.events.length, 1);
  assert.equal(evContent.events[0].type, 'conversation.first_reply');
  assert.equal(evContent.events[0].latencySeconds, 8);
});
