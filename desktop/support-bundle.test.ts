import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDiagnosticReport } from '../shared/diagnostics';
import { buildSupportBundle, scrubSecrets, SUPPORT_HINT, writeSupportBundle } from './support-bundle';

const apiKey = ['s', 'k', '-test-FAKEKEY1234567890abcdefXYZ'].join(''), licence = ['FD1_', 'ey', 'JtYWNoaW5lSWQiOiJGQUtFLU1BQ0hJTkUifQ'].join(''), customerText = '我想退款，订单号是 778899，明天能到吗', customerName = '王小花（老客户）';
const machineId = 'FAKE-MACHINE-7Q2X9';
const fixture = () => {
  const job = { id: 'job-1', conversationId: 'inbox-1', conversationName: customerName, input: customerText, reply: `${customerName}您好，${customerText}`, status: 'handoff', detail: `超时：${customerName} ${customerText}`, createdAt: new Date().toISOString(), observation: { conversationName: customerName, messages: [{ direction: 'incoming', text: customerText, stamp: '' }], composerText: customerText, observedAt: '' } };
  const config = { receptionMode: 'inbox', mode: 'auto', autoResume: true, inputBackend: 'software', inputMode: 'pico-paste', modelProtocol: 'openai-vision', pollSeconds: 5, maxRepliesPerHour: 60, knowledgeIds: ['k1'], workflowId: 'w1',
    conversations: [{ id: 'c1', name: customerName, enabled: true }], keywordRules: [{ keywords: [customerName], text: customerText }], mediaAutoReply: customerText, lightModel: 'secret-model-name', persona: { intro: customerName }, rotation: { enabled: true, targets: [{ id: 't', name: customerName }], minutesEach: 30 }, dailySummaryAt: '21:00', apiKey, licenseKey: licence };
  return {
    workspace: { provider: { hasKey: true, apiKey, baseUrl: 'https://api.example.com/v1', model: 'secret-model-name' }, knowledge: [{ title: customerName, content: customerText }], tasks: [{ input: customerText }], license: { key: licence, machineId } },
    replies: { status: 'needs_attention', message: `401 ${apiKey}`, busy: false, config, jobs: [job], events: [{ at: new Date().toISOString(), type: 'error', detail: `${customerName}: ${customerText} ${licence}` }], target: { id: 'w', name: customerName } },
    config,
  };
};

test('help file built from real-shaped state carries no key, licence, machine id, customer name or chat text', () => {
  const f = fixture();
  const report = buildDiagnosticReport({ version: '0.8.19', build: '20261020-trial.150', platform: 'darwin', workspace: f.workspace, replies: f.replies, modelTiming: { samples: [{ at: new Date().toISOString(), stage: 'CHAT_REPLY', elapsedMs: 1200, result: 'response', httpStatus: 200, prompt: customerText }] }, environment: { os: 'macOS 15.1', arch: 'arm64' }, entries: [{ at: '2026-10-20T08:00:00Z', scope: 'model', code: 'AUTH', raw: apiKey } as never], storageOk: true });
  const bundle = buildSupportBundle({ report, settings: f.config, update: { phase: 'ready', auto: true, version: '0.8.20', reason: customerText, notes: customerName } });
  for (const secret of [apiKey, licence, machineId, customerName, customerText, '王小花', '778899', 'secret-model-name', 'api.example.com'])
    assert(!bundle.includes(secret), `bundle leaked ${secret}`);
  assert(bundle.startsWith('咔哒求助包\n' + SUPPORT_HINT));
  // Still useful for support: versions, settings switches, error codes and timing stats.
  for (const useful of ['0.8.19', '"autoResume": true', '"conversations": 1', '"keywordRules": 1', '"windows": 1', 'AUTH', 'CHAT_REPLY', '"elapsedMs": 1200', '"phase": "ready"', 'macOS 15.1'])
    assert(bundle.includes(useful), `bundle lost ${useful}`);
});
test('the last line of defence masks key-shaped text that slipped into the report', () => {
  const dummyUsers = ['/', 'Users', '/wangxiaohua/Library'].join('');
  const dummyAiza = ['A', 'I', 'z', 'aSyFAKE'].join('');
  const out = scrubSecrets(`a ${apiKey} b ${licence} c Bearer abc.def ['A', 'I', 'z', 'aSyFAKEFAKEFAKEFAKEFAKE12'].join('') ${dummyUsers} C:\\Users\\wang\\AppData`);
  for (const secret of [apiKey, licence, 'abc.def', dummyAiza, 'wangxiaohua', 'wang\\']) assert(!out.includes(secret), secret);
});
test('the help file is one private .txt in the given folder', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kadadesk-support-'));
  const file = await writeSupportBundle(dir, buildSupportBundle({ report: 'r' }), new Date('2026-10-20T09:30:00Z'));
  assert.equal(file, join(dir, '咔哒求助包-2026-10-20-09-30.txt'));
  assert((await readFile(file, 'utf8')).includes(SUPPORT_HINT));
  if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
});
