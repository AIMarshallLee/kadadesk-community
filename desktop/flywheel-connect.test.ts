import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FlywheelManager } from './flywheel-connect';
import type { CustomerProfile } from '../shared/customers';
import type { ReceptionEvent } from './replies-contract';

test('FlywheelManager e2e test suite', async (t) => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'flywheel-test-'));

  let receivedEvents: any[] = [];
  let serverReturnStatus = 200;
  let serverReturnBody: any = null;

  // Mock Flywheel Hub HTTP Server
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const auth = req.headers.authorization;

    if (auth !== 'Bearer test-valid-key') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    if (url.pathname === '/api/flywheel/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, version: '1.0.0' }));
      return;
    }

    if (url.pathname === '/api/flywheel/events' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        if (serverReturnStatus !== 200) {
          res.writeHead(serverReturnStatus, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(serverReturnBody || { error: 'mock error' }));
          return;
        }

        const data = JSON.parse(body || '{}');
        const events = data.events || [];
        receivedEvents.push(...events);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(serverReturnBody || {
          accepted: events.map((e: any) => e.event_id),
          contact_mapping: {
            'local-c1': 'c_flywheel_12345',
          },
        }));
      });
      return;
    }

    if (url.pathname === '/api/flywheel/keywords') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        keywords: [
          {
            keyword: '3D案例',
            title: '实景展厅引流',
            platform: 'xhs',
            content_id: 'xhs-123',
          },
        ],
      }));
      return;
    }

    if (url.pathname === '/api/flywheel/feed') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        events: [
          {
            spec_version: '1.0',
            event_id: 'feed-lead-1',
            type: 'lead.created',
            source: { system: 'website' },
            contact: {
              display_name: '李先生(线上官网)',
              identities: [{ type: 'phone', value: '+86' + ['139', '0000', '8888'].join('') }],
            },
            payload: {
              need: '别墅全案设计',
              platform: '官网预约',
            },
          },
          {
            spec_version: '1.0',
            event_id: 'feed-stage-1',
            type: 'contract.signed',
            source: { system: 'crm' },
            contact: {
              local_id: 'local-c1',
              contact_id: 'c_flywheel_12345',
            },
            payload: {
              stage: '已签约',
              stage_name: '已签约',
            },
          },
        ],
      }));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;
  const hubUrl = `http://127.0.0.1:${port}`;

  // Fake Customers and deps
  let isCustomerWaiting = false;
  let isReceptionRunning = false;
  let currentResource: 'idle' | 'normal' | 'struggling' = 'normal';

  const mockProfiles: Map<string, CustomerProfile> = new Map();
  mockProfiles.set('local-c1', {
    id: 'local-c1',
    channel: 'desk',
    name: '张三',
    aliases: [],
    facts: [],
    tags: [],
    notes: [],
    purchases: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const upsertedLeads: any[] = [];
  const updatedStages: any[] = [];

  const manager = new FlywheelManager({
    userDataDir: tmpDir,
    customerWaiting: () => isCustomerWaiting,
    receptionRunning: () => isReceptionRunning,
    resourceLevel: () => currentResource,
    getProfile: (name) => {
      for (const p of mockProfiles.values()) {
        if (p.name === name) return p;
      }
      return undefined;
    },
    getProfileById: (id) => mockProfiles.get(id),
    getAllProfiles: () => Array.from(mockProfiles.values()),
    updateProfile: async (p) => {
      mockProfiles.set(p.id, p);
    },
    upsertExternalLead: async (lead) => {
      upsertedLeads.push(lead);
      return { merged: false, profileId: 'ext-lead-1' };
    },
    updateSalesStage: async (stage) => {
      updatedStages.push(stage);
    },
  });

  await manager.init();

  await t.test('1. testConnection verifies credentials against mock hub', async () => {
    // Bad token
    const r1 = await manager.testConnection(hubUrl, 'wrong-key');
    assert.equal(r1.ok, false);
    assert.match(r1.message, /密钥不正确/);

    // Good token
    const r2 = await manager.testConnection(hubUrl, 'test-valid-key');
    assert.equal(r2.ok, true);
    assert.match(r2.message, /连接成功/);
  });

  await t.test('2. shouldBackOff protects reception during waiting/struggling states', () => {
    assert.equal(manager.shouldBackOff(), false);

    isCustomerWaiting = true;
    assert.equal(manager.shouldBackOff(), true);
    isCustomerWaiting = false;

    currentResource = 'struggling';
    assert.equal(manager.shouldBackOff(), true);
    currentResource = 'normal';
    assert.equal(manager.shouldBackOff(), false);
  });

  await t.test('3. Enable plugin, ingest reception events into outbox', async () => {
    await manager.setConfig({
      enabled: true,
      hubUrl,
      apiKey: 'test-valid-key',
    });

    // Ingest incoming event
    const incoming: ReceptionEvent = {
      kind: 'incoming',
      conversation: '张三',
      text: '你好，我的银行卡号是 6222000011112222，我想看3D案例',
      first: true,
      at: '2026-11-02T10:00:00Z',
    };
    await manager.handleReceptionEvent(incoming);

    // Ingest reply sent event
    const reply: ReceptionEvent = {
      kind: 'reply-sent',
      conversation: '张三',
      text: '您好，请问有什么可以帮您？',
      firstInConversation: true,
      latencySeconds: 2,
      by: 'ai',
      mode: 'auto',
      at: '2026-11-02T10:00:02Z',
    };
    await manager.handleReceptionEvent(reply);

    const st = manager.getState();
    assert.equal(st.pendingCount, 2);
  });

  await t.test('4. flushOutbox transmits events safely without leaking secrets or chat texts', async () => {
    receivedEvents = [];
    const sent = await manager.flushOutbox();
    assert.equal(sent, 2);

    assert.equal(receivedEvents.length, 2);
    // Red-line verification: chat text and sensitive card number MUST NOT be transmitted
    const serialized = JSON.stringify(receivedEvents);
    assert.equal(serialized.includes('6222000011112222'), false);
    assert.equal(serialized.includes('我的银行卡号是'), false);

    // Verify contact mapping callback updated profile
    const p = mockProfiles.get('local-c1');
    assert.equal(p?.flywheelContactId, 'c_flywheel_12345');

    // Outbox should be clear
    const st = manager.getState();
    assert.equal(st.pendingCount, 0);
    assert.equal(st.sentCount, 2);
  });

  await t.test('5. Handles 5xx temporary server failures with backoff retry', async () => {
    // Queue an event
    await manager.handleReceptionEvent({
      kind: 'handoff',
      conversation: '张三',
      text: '我想问一下具体优惠多少',
      detail: '需要人工报价',
      at: '2026-11-02T10:05:00Z',
    });

    // Simulate 500 server error
    serverReturnStatus = 500;
    serverReturnBody = { error: 'Internal Server Error' };

    const sent = await manager.flushOutbox();
    assert.equal(sent, 0);

    const st = manager.getState();
    // Item is preserved in outbox
    assert.equal(st.pendingCount, 1);
    assert.ok(st.lastError);

    // Reset server status
    serverReturnStatus = 200;
    serverReturnBody = null;
  });

  await t.test('6. Synchronize keywords & feed (inbound sync)', async () => {
    await manager.syncKeywordsAndFeed();

    // 1) Keywords synced
    assert.equal(manager.getState().lastKeywordsSyncAt !== undefined, true);

    // 2) Keyword match and context injection
    const res = manager.matchKeywordForReply('张三', '你好，我想看3D案例');
    assert.ok(res);
    assert.equal(res?.matched, true);
    if (res?.matched) {
      assert.match(res.contextPrompt, /《实景展厅引流》/);
      assert.match(res.contextPrompt, /小红书/);
    }

    // 3) External lead upserted
    assert.equal(upsertedLeads.length, 1);
    assert.equal(upsertedLeads[0].displayName, '李先生(线上官网)');
    assert.equal(upsertedLeads[0].need, '别墅全案设计');

    // 4) Sales stage updated
    assert.equal(updatedStages.length, 1);
    assert.equal(updatedStages[0].contactId, 'c_flywheel_12345');
    assert.equal(updatedStages[0].stage, '已签约');
    assert.equal(updatedStages[0].dealStatus, 'won');
  });

  // Cleanup
  manager.stop();
  server.close();
  await new Promise(r => setTimeout(r, 50));
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});
