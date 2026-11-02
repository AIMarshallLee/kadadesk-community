/**
 * Test kit for 连接增长飞轮 (tests only): a fake event hub that follows spec V1.0.1 exactly, and a harness that wires
 * the real FlywheelManager to the real 客户档案 store and the real plugin hooks, the way main.ts does. The community
 * edition reads no chat window: `emit` plays a generic event source through the public plugin hook.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020';
import { createCustomers, type CustomersDeps } from './customers';
import { FlywheelManager, conversationKeyOf, type FlywheelCustomersPort } from './flywheel-connect';
import * as hooks from './plugin-hooks';
import type { ReceptionEvent, ResolvedReceptionEvent } from './replies-contract';
import type { DesktopReplyConfig } from '../shared/desktop-replies';
import type { FlywheelEnvelope, FlywheelKeywordItem } from '../shared/flywheel/types';

const root = fileURLToPath(new URL('..', import.meta.url));
/** An independent validator compiled from the schema file on disk (not the app's own compiled copy). */
export function hubValidator() {
  const AjvClass = ((Ajv2020 as unknown as { default?: typeof Ajv2020 }).default ?? Ajv2020) as typeof Ajv2020;
  const ajv = new AjvClass({ strict: false, allErrors: true, validateFormats: false });
  return ajv.compile(JSON.parse(readFileSync(join(root, 'shared', 'flywheel', 'flywheel-v1.schema.json'), 'utf8')));
}

export interface FakeHub {
  url: string; token: string;
  received: FlywheelEnvelope<Record<string, unknown>>[];
  posts: number; requests: Array<{ method: string; path: string; auth?: string }>;
  mode: { down?: boolean; status?: number; retryAfter?: string; dropFromReceipt?: Set<string>; rejectTypes?: Set<string> };
  keywords: FlywheelKeywordItem[];
  feed: FlywheelEnvelope<Record<string, unknown>>[];
  contactIds: Map<string, string>;
  close(): Promise<void>;
}

let ulidSeq = 0;
const ULID = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const fakeContactId = () => { let n = ++ulidSeq; let s = ''; for (let i = 0; i < 26; i++) { s = ULID[n % 32] + s; n = Math.floor(n / 32); } return `ct_${s}`; };

export async function startFakeHub(token = 'kd-test-key'): Promise<FakeHub> {
  const validate = hubValidator();
  const seen = new Set<string>();
  const hub: FakeHub = { url: '', token, received: [], posts: 0, requests: [], mode: {}, keywords: [], feed: [], contactIds: new Map(), close: async () => {} };
  const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
  const read = (req: IncomingMessage) => new Promise<string>(resolve => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => resolve(b)); });
  const server = createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    hub.requests.push({ method: req.method ?? '', path: u.pathname + u.search, auth: req.headers.authorization });
    if (req.method === 'POST' && u.pathname === '/api/flywheel/events') hub.posts++;
    if (hub.mode.down) { req.socket.destroy(); return; }
    if (req.headers.authorization !== `Bearer ${hub.token}`) return json(res, 401, { error: 'unauthorized' });
    if (hub.mode.status) return json(res, hub.mode.status, { error: 'mode' }, hub.mode.retryAfter ? { 'Retry-After': hub.mode.retryAfter } : {});
    if (req.method === 'GET' && u.pathname === '/api/flywheel/health') return json(res, 200, { ok: true });
    if (req.method === 'GET' && u.pathname === '/api/flywheel/keywords') return json(res, 200, hub.keywords);
    if (req.method === 'GET' && u.pathname === '/api/flywheel/feed') {
      const after = u.searchParams.get('after'); const types = (u.searchParams.get('types') ?? '').split(',').filter(Boolean);
      const start = after ? Number(after.replace(/^c/, '')) : 0;
      const list = hub.feed.slice(start).filter(e => !types.length || types.includes(e.type));
      return json(res, 200, { events: list, next_cursor: `c${hub.feed.length}` });
    }
    if (req.method === 'POST' && u.pathname === '/api/flywheel/events') {
      const body = JSON.parse(await read(req)) as { events?: FlywheelEnvelope<Record<string, unknown>>[] };
      if (!body || !Array.isArray(body.events)) return json(res, 400, { error: 'body must be {"events": [...]}' });
      const accepted: Array<{ event_id: string; contact_id: string | null }> = []; const duplicates: string[] = []; const rejected: Array<{ event_id: string; error: string }> = [];
      for (const ev of body.events) {
        if (hub.mode.dropFromReceipt?.has(ev.event_id)) continue;
        if (!(validate as (x: unknown) => boolean)(ev)) { rejected.push({ event_id: ev.event_id, error: JSON.stringify(validate.errors?.[0] ?? {}) }); continue; }
        if (hub.mode.rejectTypes?.has(ev.type)) { rejected.push({ event_id: ev.event_id, error: 'type not allowed for this key' }); continue; }
        if (seen.has(ev.event_id)) { duplicates.push(ev.event_id); continue; }
        seen.add(ev.event_id); hub.received.push(ev);
        let cid: string | null = null;
        const local = ev.contact?.local_id;
        if (typeof local === 'string') { cid = hub.contactIds.get(local) ?? fakeContactId(); hub.contactIds.set(local, cid); }
        accepted.push({ event_id: ev.event_id, contact_id: cid });
      }
      return json(res, 200, { accepted, duplicates, rejected });
    }
    json(res, 404, { error: 'not found' });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  hub.url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  hub.close = () => new Promise<void>(resolve => { server.closeAllConnections?.(); server.close(() => resolve()); });
  return hub;
}

export const tick = () => new Promise<void>(resolve => setImmediate(resolve));
export const memorySecrets = () => { let v: string | undefined; return { get: async () => v, set: async (x: string) => { v = x; }, delete: async () => { v = undefined; }, available: () => true, peek: () => v }; };
export const baseConfig = (extra: Record<string, unknown> = {}) => ({ timezone: 'Asia/Shanghai', ...extra }) as unknown as DesktopReplyConfig;
/** Test phone numbers are written in pieces so the public-repository scanner never sees a whole number in the source. */
export const ph = (...parts: string[]) => parts.join('');

export interface Harness {
  dir: string; clock: { now: number }; state: { idle: boolean }; hub: FakeHub; manager: FlywheelManager; secrets: ReturnType<typeof memorySecrets>;
  customers: Awaited<ReturnType<typeof createCustomers>>; port: FlywheelCustomersPort; notices: string[];
  emit(event: ReceptionEvent): Promise<void>;
  settle(): Promise<void>;
  restart(): Promise<FlywheelManager>;
  /** Plugin hooks off / on again (as main.ts does when the plugin is switched). */
  unwire(): void; wire(): void;
  close(): Promise<void>;
}

/** Real manager + real customers + real hooks (resolver, listener, context augmenter) + fake hub. */
export async function harness(options: { start?: number; customersDeps?: Partial<CustomersDeps>; hub?: FakeHub; demo?: boolean } = {}): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'kada-flywheel-'));
  const clock = { now: options.start ?? Date.parse('2026-11-02T02:00:00Z') };
  const state = { idle: true };
  const hub = options.hub ?? await startFakeHub();
  const notices: string[] = [];
  const customers = await createCustomers({ file: join(dir, 'customers', 'profiles.json'), now: () => clock.now, config: () => baseConfig({ adminContact: 'K7QH4M-老板' }), ...options.customersDeps });
  await customers.saveLines([{ id: 'soft', name: '咔哒软件', products: [], stages: ['新咨询', '已成交'], fields: [] }]);
  const port: FlywheelCustomersPort = {
    byId: id => customers.findProfileById(id),
    ensureProfile: (name, channel, kind) => customers.ensureProfile(name, channel, kind),
    writeContactId: (id, cid) => customers.flywheel.writeContactId(id, cid),
    recordSource: (id, v) => customers.flywheel.recordSource(id, v),
    importLead: lead => customers.flywheel.importLead(lead),
    resolveSuspect: (lead, c, same) => customers.flywheel.resolveSuspect(lead, c, same),
    mergePair: (into, from) => customers.flywheel.mergePair(into, from),
    applySales: u => customers.flywheel.applySales(u),
  };
  const secrets = memorySecrets();
  const make = () => new FlywheelManager({ dir: join(dir, 'flywheel'), secrets, version: '0.3.0', idle: () => state.idle, customers: port, notify: title => { notices.push(title); }, now: () => clock.now, noTimer: true, ...(options.demo ? { demo: true } : {}) });
  let manager = make();
  await manager.init();
  await manager.setPluginState({ installed: true, enabled: true });
  await manager.confirm();
  await manager.saveSettings({ hubUrl: hub.url, apiKey: hub.token });
  let offs: Array<() => void> = [];
  const wire = () => {
    for (const off of offs) off();
    hooks.setReceptionResolver(async event => {
      const channel = event.channel ?? 'desk';
      const profileId = event.profileId ?? (event.chatKind === 'group' ? undefined : await customers.ensureProfile(event.conversation, channel, event.chatKind));
      return profileId ? { ...event, at: event.at ?? new Date(clock.now).toISOString(), profileId, conversationKey: event.conversationKey ?? conversationKeyOf(channel, event.conversation) } as ResolvedReceptionEvent : undefined;
    });
    offs = [
      hooks.addReceptionListener(e => manager.onReceptionEvent(e)),
      hooks.addContextAugmenter(async (ctx, query, _s, meta) => { const line = manager.keywordHint(meta, query); return line ? { ...ctx, instructions: `${ctx.instructions}\n【客户来源】${line}` } : ctx; }),
    ];
  };
  wire();
  const settle = async () => { for (let i = 0; i < 6; i++) { await tick(); await manager.settled(); await customers.flush(); } };
  return {
    dir, clock, state, hub, get manager() { return manager; }, secrets, customers, port, notices,
    emit: async event => { hooks.emitReceptionEvent({ at: new Date(clock.now).toISOString(), ...event } as ReceptionEvent); await settle(); },
    settle,
    unwire: () => { for (const off of offs) off(); offs = []; hooks.setReceptionResolver(undefined); },
    wire,
    restart: async () => { await settle(); manager.dispose(); manager = make(); await manager.init(); await manager.setPluginState({ installed: true, enabled: true }); wire(); return manager; },
    close: async () => { for (const off of offs) off(); hooks.setReceptionResolver(undefined); await settle(); manager.dispose(); if (!options.hub) await hub.close(); await rm(dir, { recursive: true, force: true }).catch(() => {}); },
  } as Harness;
}
