/**
 * 连接增长飞轮 (built-in plugin, community edition): kadadesk ↔ a flywheel event hub (spec 00 V1.0 + V1.0.1).
 *
 * - Off until the plugin is installed, switched on AND the owner accepted the confirmation card. Off = nothing is sent
 *   or fetched, at once (an in-flight request is aborted); the outbox is kept and can be cleared with one click.
 * - Event sources never wait for this module: events reach it later (plugin-hooks.ts dispatches on setImmediate).
 *   The community edition reads no chat window: its sources are the core ones (customer profiles the owner edits, the
 *   feed this module imports) plus any source that emits the generic reception events. It never calls a model and
 *   never touches the mouse or keyboard.
 * - Nothing of a chat text is sent: see shared/flywheel/mapping.ts. Every event is checked against the bundled
 *   authoritative schema before it enters the outbox.
 * - Files in <userData>/flywheel/: config.json (settings, no key), state.json (counters, cursor, conversations),
 *   outbox.jsonl (pending + 需要处理), sent.jsonl (sent records, kept 30 days), keywords.json (扣词表 cache).
 *   The key lives only in the encrypted key store (Electron safeStorage); without one it cannot be saved at all.
 */
import { randomUUID, createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nameKey } from '../shared/customers';
import type { ReplyContextMeta, ResolvedReceptionEvent } from './replies-contract';
import type { FlywheelImportResult, FlywheelLeadImport, FlywheelLinkResult, FlywheelMerged, FlywheelPair } from './customers';
import { laneChannel } from '../shared/flywheel/channels';
import { cleanKeywordItems, matchKeyword } from '../shared/flywheel/keywords';
import { maskDeep } from '../shared/flywheel/mask';
import {
  CONTACT_ID, DEFAULT_WORKSPACE_ID, WORKSPACE_ID, beijingIso, contactFor, contactProfiled, conversationFirstReply, conversationHandoff, conversationStarted,
  handoffReason, lead, type EventContext, type ProfileLike,
} from '../shared/flywheel/mapping';
import { flywheelEventError } from '../shared/flywheel/validate';
import type { CaptureChannel, FlywheelEnvelope, FlywheelKeywordItem, FlywheelSettings, FlywheelSuspect, FlywheelView } from '../shared/flywheel/types';

/** The encrypted key store. `available() === false`: no encryption on this computer, so no key is kept at all. */
export interface SecretStore { get(): Promise<string | undefined>; set(value: string): Promise<void>; delete(): Promise<void>; available?(): boolean }
export interface FlywheelCustomersPort {
  byId(id: string): (ProfileLike & { channel?: 'desk' | 'phone' }) | undefined;
  ensureProfile(name: string, channel: 'desk' | 'phone', chatKind?: 'direct' | 'group'): Promise<string | undefined>;
  writeContactId(profileId: string, contactId: string): Promise<FlywheelLinkResult | boolean | undefined>;
  recordSource(profileId: string, value: string): Promise<unknown>;
  importLead(lead: FlywheelLeadImport): Promise<FlywheelImportResult>;
  resolveSuspect(lead: FlywheelLeadImport, candidateId: string, same: boolean): Promise<FlywheelImportResult>;
  /** 疑似同一人 between two profiles that both have chats, answered 是同一人. */
  mergePair?(intoId: string, fromId: string): Promise<unknown>;
  applySales(update: { contactId?: string; identities?: Array<{ type: string; value: string }>; type: string; to?: string; dueAt?: string }): Promise<boolean>;
}
export interface FlywheelDeps {
  dir: string;
  secrets: SecretStore;
  /** app.getVersion() */
  version: string;
  /** Cheap check, no copying: the computer is not busy with something that comes first. */
  idle(): boolean;
  customers?: FlywheelCustomersPort;
  /** A desktop reminder (notice center, key 'flywheel'). */
  notify?(title: string, body: string): void;
  fetch?: typeof fetch;
  now?: () => number;
  /** Tests: no interval timer. */
  noTimer?: boolean;
  /** Live tests against a real hub: events are marked is_demo. */
  demo?: boolean;
}

interface OutboxItem { id: string; envelope: FlywheelEnvelope<unknown>; tries: number; nextAt: number; addedAt: number; status: 'pending' | 'attention'; reason?: string }
interface Conversation { lastAt: number; startedAt: number; id: string; incoming: number; firstReplyAt?: number }
interface StoredSuspect extends FlywheelSuspect { lead: FlywheelLeadImport; /** kind 'pair': the other profile (candidateId is the one already holding the id). */ pairWith?: string }
interface State {
  version: 1; instanceId: string;
  sent: number; errors: number; lastSuccessAt?: string; lastError?: string;
  pausedReason?: string; pausedUntil?: number; notBefore?: number;
  /** The hub's opaque feed cursor: stored and sent back exactly as received, never parsed. */
  cursor?: string; lastFeedAt?: string; lastKeywordsSyncAt?: string;
  conversations: Record<string, Conversation>;
  firstSeen: string[]; feedSeen: string[]; keywordLeads: Record<string, number>;
  suspects: StoredSuspect[];
  /** Profile pairs the owner said are different people (or ignored): not asked again. */
  distinct: string[];
  /** Summaries of the latest events (open interface reception_events_since): types, times and codes only. */
  recent: EventSummary[];
}
export interface EventSummary { type: string; at: string; profileId?: string; channel?: string; latencySeconds?: number; by?: string; mode?: string; reason?: string; captureChannel?: string; fields?: string[] }

const DAY = 86_400_000;
const TIMEOUT_MS = 15_000;
const SYNC_EVERY_MS = 5 * 60_000;
const TICK_MS = 30_000;
const BACKOFF = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000];
const HOUR = 3600_000;
const SENT_KEEP_MS = 30 * DAY;
const MAX_OUTBOX = 20_000;
const FEED_TYPES_LEADS = ['lead.created', 'lead.touched', 'visit.done'];
const FEED_TYPES_SALES = ['stage.changed', 'followup.scheduled', 'deal.lost', 'contract.signed'];
const CAPTURE_LABEL: Record<string, string> = { dm: '私信', comment: '评论区', keyword: '扣词', form: '表单', add_friend: '加好友', group: '群', visit: '线下走访', event: '活动', referral: '转介绍', partner: '渠道伙伴', map_listing: '地图门店', showroom_booking: '展厅预约', other: '其他' };
const SYSTEM_LABEL: Record<string, string> = { 'content-factory': '内容工厂', crm: 'CRM', 'feishu-bitable': '飞书表格', 'command-center': '总控工作台', manual: '手动录入' };

export const DEFAULT_SETTINGS: FlywheelSettings = { hubUrl: '', workspaceId: DEFAULT_WORKSPACE_ID, sendReceptionEvents: true, sendProfileUpdates: true, receiveExternalLeads: true, receiveSalesStages: true };
const emptyState = (): State => ({ version: 1, instanceId: `kd-${randomUUID().replace(/-/g, '').slice(0, 16)}`, sent: 0, errors: 0, conversations: {}, firstSeen: [], feedSeen: [], keywordLeads: {}, suspects: [], distinct: [], recent: [] });

const pairKey = (a: string, b: string) => [a, b].sort().join('\0');
/** The conversation key used everywhere: a hash of account + chat name (the name itself never leaves this computer). */
export const conversationKeyOf = (channel: 'desk' | 'phone' | undefined, name: string) => createHash('sha256').update(`${channel ?? 'desk'}\0${nameKey(name)}`).digest('hex').slice(0, 32);

/** Retry-After: seconds or an HTTP date; undefined when missing or unreadable. Capped at a day. */
export function retryAfterMs(value: string | null | undefined, now: number): number | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Math.min(DAY, Number(v) * 1000);
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.min(DAY, Math.max(0, t - now)) : undefined;
}
export const backoffMs = (tries: number) => tries <= BACKOFF.length ? BACKOFF[Math.max(0, tries - 1)]! : HOUR;

export function validHubUrl(raw: string): string {
  const s = raw.trim().replace(/\/+$/, '');
  if (!s) return '';
  let u: URL; try { u = new URL(s); } catch { throw new Error('事件中心地址不对，要以 https:// 开头。'); }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  if (!(u.protocol === 'https:' || (u.protocol === 'http:' && local)) || u.username || u.password || u.search || u.hash) throw new Error('事件中心地址要用 https://（只有本机测试地址可以用 http://）。');
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

export class FlywheelManager {
  private settings: FlywheelSettings = { ...DEFAULT_SETTINGS };
  private state: State = emptyState();
  private outbox: OutboxItem[] = [];
  private keywords: FlywheelKeywordItem[] = [];
  private sentAppend: string[] = [];
  private key: string | undefined;
  private plugin = { known: false, installed: false, enabled: false };
  private timer?: ReturnType<typeof setInterval>;
  private sending = false;
  private syncing = false;
  private lastSyncAt = 0;
  private lastSentPrune = 0;
  private inflight = new Set<AbortController>();
  private queue: Promise<unknown> = Promise.resolve();
  private writeChain: Promise<void> = Promise.resolve();
  private writeQueued = false;
  private readonly files: { config: string; state: string; outbox: string; sent: string; keywords: string };

  constructor(private readonly deps: FlywheelDeps) {
    const d = deps.dir;
    this.files = { config: join(d, 'config.json'), state: join(d, 'state.json'), outbox: join(d, 'outbox.jsonl'), sent: join(d, 'sent.jsonl'), keywords: join(d, 'keywords.json') };
  }

  private now() { return this.deps.now?.() ?? Date.now(); }
  private keyStore() { try { return this.deps.secrets.available?.() ?? true; } catch { return false; } }
  get active() { return this.plugin.installed && this.plugin.enabled && !!this.settings.consentAt; }
  private ctx(): EventContext { return { workspaceId: this.settings.workspaceId, instance: this.state.instanceId, version: this.deps.version, now: () => this.now(), ...(this.deps.demo ? { demo: true } : {}) }; }

  async init() {
    await mkdir(this.deps.dir, { recursive: true });
    const json = async <T>(file: string): Promise<T | undefined> => { try { return JSON.parse(await readFile(file, 'utf8')) as T; } catch { return undefined; } };
    const cfg = await json<Partial<FlywheelSettings> & { apiKey?: unknown; enabled?: unknown }>(this.files.config);
    if (cfg) {
      this.settings = { ...DEFAULT_SETTINGS, ...pick(cfg) };
      // The first community version kept the key in this file: move it into the encrypted store and drop it here.
      if (typeof cfg.apiKey === 'string' && cfg.apiKey.trim() && this.keyStore()) { try { await this.deps.secrets.set(cfg.apiKey.trim()); } catch { /* store unavailable: the owner pastes it again */ } }
      if ('apiKey' in cfg || 'enabled' in cfg) await this.saveConfig();
    }
    const st = await json<Partial<State>>(this.files.state);
    if (st && st.version === 1 && typeof st.instanceId === 'string') this.state = { ...emptyState(), ...st, conversations: st.conversations ?? {}, firstSeen: st.firstSeen ?? [], feedSeen: st.feedSeen ?? [], keywordLeads: st.keywordLeads ?? {}, suspects: st.suspects ?? [], distinct: st.distinct ?? [], recent: st.recent ?? [] } as State;
    this.keywords = cleanKeywordItems(await json<unknown>(this.files.keywords));
    try {
      for (const line of (await readFile(this.files.outbox, 'utf8')).split('\n')) {
        if (!line.trim()) continue;
        try { const item = JSON.parse(line) as OutboxItem; if (item?.id && item.envelope && (item.status === 'pending' || item.status === 'attention')) this.outbox.push(item); } catch { /* a torn last line */ }
      }
    } catch { /* no outbox yet */ }
    try { this.key = (await this.deps.secrets.get())?.trim() || undefined; } catch { this.key = undefined; }
    await this.persist();
    if (!this.deps.noTimer) { this.timer = setInterval(() => { void this.tick().catch(() => {}); }, TICK_MS); this.timer.unref?.(); }
  }

  /** Tests and shutdown: queued event handling and file writes have finished. */
  async settled() { await this.queue; await this.writeChain; }

  dispose() { if (this.timer) clearInterval(this.timer); this.timer = undefined; this.abortInflight(); }
  private abortInflight() { for (const c of this.inflight) c.abort(); this.inflight.clear(); }

  /** From the plugin manager: installed / switched on. Uninstalling forgets the key, the consent and the outbox. */
  async setPluginState(next: { installed: boolean; enabled: boolean }) {
    const wasInstalled = this.plugin.known && this.plugin.installed;
    this.plugin = { known: true, installed: next.installed, enabled: next.installed && next.enabled };
    if (!this.active) this.abortInflight();
    if (wasInstalled && !next.installed) {
      delete this.settings.consentAt; await this.saveConfig();
      try { await this.deps.secrets.delete(); } catch { /* ignore */ } this.key = undefined;
      this.outbox = []; this.state.suspects = []; delete this.state.pausedReason; delete this.state.lastError;
      await this.persist();
    }
  }
  /** The owner accepted the confirmation card. */
  async confirm() { this.settings.consentAt = new Date(this.now()).toISOString(); await this.saveConfig(); }

  view(): FlywheelView {
    const { consentAt, ...settings } = this.settings;
    const attention = this.outbox.filter(i => i.status === 'attention');
    return {
      active: this.active, installed: this.plugin.installed, pluginEnabled: this.plugin.enabled, consented: !!consentAt,
      settings, apiKeyConfigured: !!this.key, keyStoreAvailable: this.keyStore(),
      sent: this.state.sent, pending: this.outbox.length - attention.length, attention: attention.length, errors: this.state.errors,
      ...(this.state.lastSuccessAt ? { lastSuccessAt: this.state.lastSuccessAt } : {}), ...(this.state.lastError ? { lastError: this.state.lastError } : {}),
      ...(this.paused() ? { pausedReason: this.state.pausedReason } : {}),
      keywords: this.keywords.length, ...(this.state.lastKeywordsSyncAt ? { lastKeywordsSyncAt: this.state.lastKeywordsSyncAt } : {}), ...(this.state.lastFeedAt ? { lastFeedAt: this.state.lastFeedAt } : {}),
      attentionItems: attention.slice(-50).reverse().map(i => ({ id: i.id, type: i.envelope.type, at: new Date(i.addedAt).toISOString(), reason: i.reason ?? '' })),
      suspects: this.state.suspects.map(({ lead: _lead, pairWith: _pair, ...s }) => s),
    };
  }

  async saveSettings(patch: Record<string, unknown>) {
    const next = { ...this.settings };
    if (patch.hubUrl !== undefined) next.hubUrl = validHubUrl(String(patch.hubUrl ?? ''));
    if (patch.workspaceId !== undefined) { const w = String(patch.workspaceId ?? '').trim(); if (!WORKSPACE_ID.test(w)) throw new Error('工作区编号只能用小写字母、数字、下划线和短横线（2～63 位）。'); next.workspaceId = w; }
    for (const k of ['sendReceptionEvents', 'sendProfileUpdates', 'receiveExternalLeads', 'receiveSalesStages'] as const) if (typeof patch[k] === 'boolean') next[k] = patch[k] as boolean;
    if (typeof patch.apiKey === 'string') {
      const k = patch.apiKey.trim();
      if (k.length > 500 || /\s/.test(k)) throw new Error('密钥格式不对，请重新复制粘贴。');
      if (k && !this.keyStore()) throw new Error('这台电脑没有可用的加密存储，密钥不能保存（咔哒不会把密钥明文写在电脑上）。');
      if (k) { await this.deps.secrets.set(k); this.key = k; } else { await this.deps.secrets.delete(); this.key = undefined; }
    }
    const changedTarget = next.hubUrl !== this.settings.hubUrl || typeof patch.apiKey === 'string';
    this.settings = next; await this.saveConfig();
    if (changedTarget) { delete this.state.pausedReason; delete this.state.pausedUntil; delete this.state.notBefore; for (const i of this.outbox) if (i.status === 'pending') i.nextAt = 0; await this.persist(); }
    return this.view();
  }

  async testConnection(input: { hubUrl?: string; apiKey?: string } = {}): Promise<{ ok: boolean; message: string }> {
    let url: string;
    try { url = validHubUrl(input.hubUrl ?? this.settings.hubUrl); } catch (e) { return { ok: false, message: (e as Error).message }; }
    const key = input.apiKey?.trim() || this.key;
    if (!url) return { ok: false, message: '请先填写事件中心地址。' };
    if (!key) return { ok: false, message: '请先粘贴密钥。' };
    try {
      const res = await this.request(`${url}/api/flywheel/health`, { method: 'GET', headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } });
      if (res.status === 401 || res.status === 403) return { ok: false, message: '密钥不对，请重新粘贴。' };
      if (res.status === 404) return { ok: false, message: '地址能打开，但不是事件中心（找不到接口），请检查地址。' };
      if (!res.ok) return { ok: false, message: `事件中心暂时有问题（HTTP ${res.status}），稍后再试。` };
      if (!input.apiKey && !input.hubUrl) { delete this.state.pausedReason; delete this.state.pausedUntil; await this.persist(); }
      return { ok: true, message: '连接成功，事件中心在线。' };
    } catch { return { ok: false, message: '连不上事件中心，请检查地址和网络。客户接待不受影响。' }; }
  }

  async clearOutbox() { this.outbox = []; await this.persist(); return this.view(); }
  async resend(id?: string) { for (const i of this.outbox) if (i.status === 'attention' && (!id || i.id === id)) { i.status = 'pending'; i.tries = 0; i.nextAt = 0; delete i.reason; } await this.persist(); return this.view(); }
  async dropAttention(id: string) { this.outbox = this.outbox.filter(i => !(i.status === 'attention' && i.id === id)); await this.persist(); return this.view(); }
  async answerSuspect(id: string, same: boolean | 'ignore') {
    const s = this.state.suspects.find(x => x.id === id); if (!s) throw new Error('这条提示已经处理过了。');
    this.state.suspects = this.state.suspects.filter(x => x.id !== id);
    if (s.kind === 'pair' && s.pairWith) {
      if (same === true) { if (this.deps.customers?.mergePair) { await this.deps.customers.mergePair(s.pairWith, s.candidateId); this.remap([{ from: s.candidateId, into: s.pairWith, intoName: s.displayName }]); } }
      else this.state.distinct = [...this.state.distinct.filter(k => k !== pairKey(s.pairWith!, s.candidateId)), pairKey(s.pairWith, s.candidateId)].slice(-200);
    } else if (same !== 'ignore' && this.deps.customers) this.afterLink(await this.deps.customers.resolveSuspect(s.lead, s.candidateId, same));
    await this.persist(); return this.view();
  }

  /** The 客户档案 merged pre-created profiles (prompts follow them) or found two chatted profiles of one person (asked). */
  private afterLink(r: FlywheelImportResult | FlywheelLinkResult | boolean | undefined) {
    if (!r || typeof r !== 'object') return;
    const merged = (r as { merged?: FlywheelMerged[] }).merged; const pairs = (r as { pairs?: FlywheelPair[] }).pairs;
    if (merged?.length) this.remap(merged);
    for (const p of pairs ?? []) {
      const key = pairKey(p.profileId, p.candidateId);
      if (this.state.distinct.includes(key) || this.state.suspects.some(s => s.kind === 'pair' && s.pairWith && pairKey(s.pairWith, s.candidateId) === key)) continue;
      this.state.suspects.push({ id: randomUUID().slice(0, 12), at: new Date(this.now()).toISOString(), kind: 'pair', displayName: p.profileName, candidateId: p.candidateId, candidateName: p.candidateName, via: '增长飞轮', pairWith: p.profileId, lead: { displayName: p.profileName, identities: [] } });
      this.state.suspects = this.state.suspects.slice(-50);
      try { this.deps.notify?.('增长飞轮：可能是同一位客户', `「${p.profileName}」和「${p.candidateName}」的手机号或增长飞轮客户编号一样，两个档案都不是咔哒预建的。咔哒没有自动合并，请在「插件 → 连接增长飞轮」里确认。`); } catch { /* optional */ }
    }
  }
  private remap(merged: FlywheelMerged[]) {
    for (const m of merged) for (const s of this.state.suspects) {
      if (s.candidateId === m.from) { s.candidateId = m.into; s.candidateName = m.intoName; }
      if (s.pairWith === m.from) { s.pairWith = m.into; s.displayName = m.intoName; s.lead = { ...s.lead, displayName: m.intoName }; }
    }
    this.state.suspects = this.state.suspects.filter(s => !(s.kind === 'pair' && s.pairWith === s.candidateId));
  }

  /** Open interface: summaries since a time (no names, no identities, no text, no field values). */
  recentEvents(since: string, limit: number): EventSummary[] {
    const t = Date.parse(since); if (!Number.isFinite(t)) return [];
    return this.state.recent.filter(e => Date.parse(e.at) >= t).slice(-Math.max(1, Math.min(100, limit)));
  }

  // ——— reception → events ———

  private serial<T>(work: () => Promise<T>): Promise<T> { const run = this.queue.then(work, work); this.queue = run.catch(() => {}); return run; }

  onReceptionEvent(e: ResolvedReceptionEvent): Promise<void> {
    if (!this.active) return Promise.resolve();
    return this.serial(async () => {
      if (!this.active) return;
      const p = this.deps.customers?.byId(e.profileId); if (!p) return;
      const t = Number.isFinite(Date.parse(e.at)) ? Date.parse(e.at) : this.now();
      const at = beijingIso(t); const ctx = this.ctx(); const key = e.conversationKey;
      const customer = () => contactFor(p, 'customer', at);
      let conv = this.state.conversations[key];
      let changed = false;
      const send = this.settings.sendReceptionEvents;
      if (e.kind === 'incoming') {
        if (!conv || t - conv.lastAt >= DAY) {
          conv = { lastAt: t, startedAt: t, id: `cv_${key.slice(0, 16)}_${t.toString(36)}`, incoming: 1 };
          this.state.conversations[key] = conv; changed = true;
          if (send) this.enqueue(conversationStarted(ctx, customer(), laneChannel(e.channel, e.app), at, conv.id));
        } else { conv.lastAt = Math.max(conv.lastAt, t); conv.incoming++; changed = true; }
      } else if (e.kind === 'reply-sent') {
        if (!conv || t - conv.lastAt >= DAY) {
          // We wrote first (no customer message in 24 h): activity for the 24-hour rule, no conversation started.
          this.state.conversations[key] = { lastAt: t, startedAt: t, id: `cv_${key.slice(0, 16)}_${t.toString(36)}`, incoming: 0, firstReplyAt: t }; changed = true;
        } else {
          conv.lastAt = Math.max(conv.lastAt, t); changed = true;
          if (!conv.firstReplyAt && conv.incoming > 0) {
            conv.firstReplyAt = t;
            if (send) this.enqueue(conversationFirstReply(ctx, customer(), { latencySeconds: (t - conv.startedAt) / 1000, by: e.by, mode: e.mode, at, conversationId: conv.id }));
          }
        }
      } else if (e.kind === 'handoff') {
        if (send) { this.enqueue(conversationHandoff(ctx, customer(), handoffReason(e.cause, e.ruleKeyword), at, conv?.id)); changed = true; }
      } else if (e.kind === 'profile-updated') {
        if (this.settings.sendProfileUpdates) for (const ev of contactProfiled(ctx, contactFor(p, p.lastContactAt ? 'customer' : 'none', at), e.changedFacts.map(f => ({ ...f, source: f.source ?? 'inferred' })), at)) { this.enqueue(ev); changed = true; }
      } else if (e.kind === 'lead-captured') {
        if (send) {
          const d = e.detail ?? {};
          this.enqueueLead(p, e.captureChannel, at, { platform: d.platform, need: d.need, keyword: d.keyword, contentId: d.contentId });
          changed = true;
        }
      }
      if (changed) { this.prune(); await this.persist(); }
    });
  }

  /** Identities only for a person who wrote to us (lastContactAt); a profile nobody chatted with goes without them. */
  private enqueueLead(p: ProfileLike, channel: CaptureChannel, at: string, extra: { platform?: string; need?: string; keyword?: string; contentId?: string } = {}) {
    const first = !this.state.firstSeen.includes(p.id);
    const ev = lead(this.ctx(), contactFor(p, p.lastContactAt ? 'customer' : 'none', at), { first, channel, at, platform: extra.platform, need: extra.need, keyword: extra.keyword, contentId: extra.contentId });
    if (ev && this.enqueue(ev) && first) this.state.firstSeen.push(p.id);
  }

  /**
   * 扣词 on the first customer message of a conversation: returns the line for the reply context (sync, in memory),
   * and records the source fact + lead.created(keyword) later, off the reply path.
   */
  keywordHint(meta: ReplyContextMeta | undefined, text: string | undefined): string | undefined {
    if (!this.active || !meta || !text || !meta.firstInConversation || meta.chatKind === 'group' || !this.keywords.length) return undefined;
    const key = conversationKeyOf(meta.channel, meta.conversation);
    const now = this.now();
    const conv = this.state.conversations[key];
    // Another message (either side) in the last 24 h means this is not a conversation's first message, unless that
    // record was opened by this very message moments ago.
    if (conv && now - conv.lastAt < DAY && !(now - conv.startedAt < 10 * 60_000 && conv.incoming <= 1)) return undefined;
    const m = matchKeyword(text, this.keywords); if (!m) return undefined;
    const doneAt = this.state.keywordLeads[key];
    if (!doneAt || now - doneAt >= DAY) {
      this.state.keywordLeads[key] = now;
      setImmediate(() => { void this.recordKeywordLead(meta, m.item, m.keyword, m.sourceFact).catch(() => {}); });
    }
    return m.contextLine;
  }

  private recordKeywordLead(meta: ReplyContextMeta, item: FlywheelKeywordItem, keyword: string, sourceFact: string) {
    return this.serial(async () => {
      const c = this.deps.customers; if (!this.active || !c) return;
      const id = await c.ensureProfile(meta.conversation, meta.channel, meta.chatKind); if (!id) return;
      await c.recordSource(id, sourceFact);
      const p = c.byId(id); if (!p) return;
      if (this.settings.sendReceptionEvents) this.enqueueLead(p, 'keyword', beijingIso(this.now()), { keyword, contentId: item.content_id, platform: item.platform, need: item.title ? `看了《${item.title}》` : undefined });
      await this.persist();
    });
  }

  /** Masks again (defence in depth; identities are left alone), checks the schema, then queues. False: dropped and counted. */
  private enqueue(ev: FlywheelEnvelope<unknown>): boolean {
    const safe: FlywheelEnvelope<unknown> = { ...ev, payload: maskDeep(ev.payload) };
    const error = flywheelEventError(safe);
    if (error) { this.state.errors++; this.state.lastError = `有一条事件格式不对，没有放进发件箱（${error}）。`; return false; }
    if (this.outbox.length >= MAX_OUTBOX) { const i = this.outbox.findIndex(x => x.status === 'pending'); if (i >= 0) { this.outbox.splice(i, 1); this.state.errors++; } }
    this.outbox.push({ id: safe.event_id, envelope: safe, tries: 0, nextAt: 0, addedAt: this.now(), status: 'pending' });
    const pl = (safe.payload ?? {}) as Record<string, unknown>;
    this.state.recent.push({ type: safe.type, at: safe.occurred_at, ...(safe.contact?.local_id ? { profileId: safe.contact.local_id } : {}),
      ...(typeof pl.channel === 'string' ? { channel: pl.channel } : {}), ...(typeof pl.latency_seconds === 'number' ? { latencySeconds: pl.latency_seconds } : {}),
      ...(typeof pl.by === 'string' ? { by: pl.by } : {}), ...(typeof pl.mode === 'string' ? { mode: pl.mode } : {}), ...(typeof pl.reason === 'string' ? { reason: pl.reason } : {}),
      ...(typeof pl.capture_channel === 'string' ? { captureChannel: pl.capture_channel } : {}), ...(pl.fields && typeof pl.fields === 'object' ? { fields: Object.keys(pl.fields as object) } : {}) });
    if (this.state.recent.length > 500) this.state.recent = this.state.recent.slice(-500);
    return true;
  }

  private prune() {
    const now = this.now();
    const convs = Object.entries(this.state.conversations).filter(([, c]) => now - c.lastAt < 30 * DAY).sort((a, b) => b[1].lastAt - a[1].lastAt).slice(0, 5000);
    this.state.conversations = Object.fromEntries(convs);
    this.state.keywordLeads = Object.fromEntries(Object.entries(this.state.keywordLeads).filter(([, at]) => now - at < DAY));
    if (this.state.firstSeen.length > 20000) this.state.firstSeen = this.state.firstSeen.slice(-20000);
    if (this.state.feedSeen.length > 2000) this.state.feedSeen = this.state.feedSeen.slice(-2000);
  }

  // ——— sending / fetching (idle only) ———

  private paused() { return !!this.state.pausedReason && (this.state.pausedUntil ?? Infinity) > this.now(); }
  private base() { return this.settings.hubUrl.replace(/\/+$/, ''); }

  async tick() {
    if (!this.active || !this.settings.hubUrl || !this.key) return;
    if (!this.deps.idle()) return; // the computer is busy with something that comes first
    await this.flush();
    if (this.now() - this.lastSyncAt >= SYNC_EVERY_MS && this.deps.idle()) await this.sync();
    if (this.now() - this.lastSentPrune >= DAY) { this.lastSentPrune = this.now(); await this.pruneSent(); }
  }

  /** fetch with a 15 s timeout; aborted at once when the plugin is switched off. */
  private async request(url: string, init: RequestInit): Promise<Response> {
    const ctrl = new AbortController(); this.inflight.add(ctrl);
    const timer = setTimeout(() => ctrl.abort(new Error('timeout')), TIMEOUT_MS);
    try { return await (this.deps.fetch ?? globalThis.fetch)(url, { ...init, signal: ctrl.signal }); }
    finally { clearTimeout(timer); this.inflight.delete(ctrl); }
  }

  async flush(): Promise<number> {
    if (this.sending || !this.active || !this.settings.hubUrl || !this.key || this.paused()) return 0;
    const now = this.now();
    if (this.state.notBefore && now < this.state.notBefore) return 0;
    const ready: OutboxItem[] = []; let bytes = 20;
    for (const i of this.outbox) {
      if (i.status !== 'pending' || i.nextAt > now) continue;
      const size = Buffer.byteLength(JSON.stringify(i.envelope)) + 1;
      if (ready.length >= 100 || bytes + size > 1_000_000) break;
      ready.push(i); bytes += size;
    }
    if (!ready.length) return 0;
    this.sending = true;
    try {
      let res: Response;
      try {
        res = await this.request(`${this.base()}/api/flywheel/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${this.key}` }, body: JSON.stringify({ events: ready.map(i => i.envelope) }) });
      } catch {
        if (!this.active) return 0;
        this.retryLater(ready); this.state.lastError = '事件中心暂时连不上，咔哒会自动重试，客户接待不受影响。'; await this.persist(); return 0;
      }
      if (!this.active) return 0;
      const t = this.now();
      if (res.status >= 200 && res.status < 300) {
        let receipt: { accepted?: unknown; duplicates?: unknown; rejected?: unknown } = {};
        try { receipt = await res.json() as typeof receipt; } catch { receipt = {}; }
        const byId = new Map(ready.map(i => [i.id, i]));
        const done = new Set<string>(); let sent = 0; let rejected = 0;
        const writes: Array<Promise<unknown>> = [];
        for (const a of Array.isArray(receipt.accepted) ? receipt.accepted : []) {
          const id = a && typeof a === 'object' ? (a as { event_id?: unknown }).event_id : undefined;
          const item = typeof id === 'string' ? byId.get(id) : undefined; if (!item || done.has(item.id)) continue;
          done.add(item.id); sent++;
          const contactId = (a as { contact_id?: unknown }).contact_id;
          const localId = item.envelope.contact?.local_id;
          if (typeof contactId === 'string' && CONTACT_ID.test(contactId) && typeof localId === 'string' && this.deps.customers) writes.push(this.deps.customers.writeContactId(localId, contactId).then(r => this.afterLink(r)).catch(() => {}));
          this.sentAppend.push(JSON.stringify({ id: item.id, type: item.envelope.type, sentAt: new Date(t).toISOString(), ...(typeof contactId === 'string' ? { contactId } : {}) }));
        }
        for (const id of Array.isArray(receipt.duplicates) ? receipt.duplicates : []) {
          const item = typeof id === 'string' ? byId.get(id) : undefined; if (!item || done.has(item.id)) continue;
          done.add(item.id); sent++;
          this.sentAppend.push(JSON.stringify({ id: item.id, type: item.envelope.type, sentAt: new Date(t).toISOString(), duplicate: true }));
        }
        for (const r of Array.isArray(receipt.rejected) ? receipt.rejected : []) {
          const id = r && typeof r === 'object' ? (r as { event_id?: unknown }).event_id : undefined;
          const item = typeof id === 'string' ? byId.get(id) : undefined; if (!item || done.has(item.id)) continue;
          done.add(item.id); rejected++;
          const why = typeof (r as { error?: unknown }).error === 'string' ? String((r as { error: string }).error).slice(0, 120) : '没有说明原因';
          item.status = 'attention'; item.reason = `事件中心没收下这条：${why}`;
        }
        this.outbox = this.outbox.filter(i => !(done.has(i.id) && i.status === 'pending'));
        this.retryLater(ready.filter(i => !done.has(i.id))); // not in the receipt: not delivered, try again later
        await Promise.all(writes);
        this.state.sent += sent; this.state.errors += rejected;
        this.state.lastSuccessAt = new Date(t).toISOString();
        this.state.lastError = rejected ? `有 ${rejected} 条事件中心没收下，放在「需要处理」里了。` : undefined;
        delete this.state.notBefore;
        await this.persist();
        return sent;
      }
      if (res.status === 401 || res.status === 403) {
        this.state.pausedReason = '密钥不对或没有权限：请重新粘贴密钥，再点「测试连接」。事件先存在电脑上，不会丢。';
        this.state.pausedUntil = t + HOUR; this.state.lastError = this.state.pausedReason;
        await this.persist(); return 0;
      }
      if (res.status === 429 || res.status >= 500) {
        const wait = res.status === 429 ? retryAfterMs(res.headers.get('retry-after'), t) : undefined;
        this.retryLater(ready, wait);
        if (wait !== undefined) this.state.notBefore = t + wait;
        this.state.lastError = res.status === 429 ? '事件中心说发得太频繁，咔哒会按它要求的时间再发。' : '事件中心暂时连不上，咔哒会自动重试，客户接待不受影响。';
        await this.persist(); return 0;
      }
      const reason = res.status === 404 ? '事件中心地址好像不对（找不到接口），改好地址后点「重新发送」。'
        : res.status === 413 ? '这批数据太大，事件中心没收下。可以点「重新发送」再试一次，或请事件中心的管理员看看。'
        : `事件中心说这批数据不对（HTTP ${res.status}），不会自动重发。可以点「重新发送」，或请事件中心的管理员看看。`;
      for (const i of ready) { i.status = 'attention'; i.reason = reason; }
      this.state.errors += ready.length; this.state.lastError = reason;
      await this.persist(); return 0;
    } finally { this.sending = false; }
  }

  private retryLater(items: OutboxItem[], waitMs?: number) {
    const now = this.now();
    for (const i of items) { i.tries++; i.nextAt = now + (waitMs ?? backoffMs(i.tries)); }
  }

  async sync() {
    if (this.syncing || !this.active || !this.settings.hubUrl || !this.key || this.paused()) return;
    this.syncing = true; this.lastSyncAt = this.now();
    try {
      const auth = { Authorization: `Bearer ${this.key}`, Accept: 'application/json' };
      try {
        const res = await this.request(`${this.base()}/api/flywheel/keywords`, { method: 'GET', headers: auth });
        if (res.ok) {
          const raw = await res.json();
          if (Array.isArray(raw)) { this.keywords = cleanKeywordItems(raw); this.state.lastKeywordsSyncAt = new Date(this.now()).toISOString(); await this.atomic(this.files.keywords, JSON.stringify(this.keywords)); }
        } else if (res.status === 401 || res.status === 403) { this.state.lastError = '密钥不对或没有权限：请重新粘贴密钥，再点「测试连接」。'; }
      } catch { /* next time */ }
      const types = [...(this.settings.receiveExternalLeads ? FEED_TYPES_LEADS : []), ...(this.settings.receiveSalesStages ? FEED_TYPES_SALES : [])];
      if (!types.length || !this.active) return;
      for (let page = 0; page < 5 && this.active; page++) {
        const after = this.state.cursor;
        const res = await this.request(`${this.base()}/api/flywheel/feed?${after !== undefined ? `after=${encodeURIComponent(after)}&` : ''}types=${types.join(',')}&limit=200`, { method: 'GET', headers: auth }).catch(() => undefined);
        if (!res?.ok) break;
        const body = await res.json().catch(() => undefined) as { events?: unknown; next_cursor?: unknown } | undefined;
        const events = Array.isArray(body?.events) ? body!.events as FlywheelEnvelope<Record<string, unknown>>[] : [];
        let ok = true;
        for (const ev of events) {
          if (!this.active) { ok = false; break; }
          if (!ev || typeof ev !== 'object' || typeof ev.event_id !== 'string') continue;
          if (ev.source?.system === 'kadadesk' || this.state.feedSeen.includes(ev.event_id)) continue;
          try { await this.handleFeed(ev); } catch { ok = false; break; }
          this.state.feedSeen.push(ev.event_id);
        }
        if (!ok) break;
        if (typeof body?.next_cursor === 'string') this.state.cursor = body.next_cursor;
        this.state.lastFeedAt = new Date(this.now()).toISOString();
        this.prune(); await this.persist();
        if (events.length < 200 || body?.next_cursor === after) break;
      }
    } finally { this.syncing = false; }
  }

  private async handleFeed(ev: FlywheelEnvelope<Record<string, unknown>>) {
    const c = this.deps.customers; if (!c) return;
    const contactId = typeof ev.contact?.contact_id === 'string' && CONTACT_ID.test(ev.contact.contact_id) ? ev.contact.contact_id : undefined;
    const identities = (Array.isArray(ev.contact?.identities) ? ev.contact!.identities! : []).filter(i => i && typeof i.type === 'string' && typeof i.value === 'string').slice(0, 10);
    if (FEED_TYPES_LEADS.includes(ev.type) && this.settings.receiveExternalLeads) {
      const p = ev.payload ?? {};
      const kw = typeof ev.refs?.content_id === 'string' ? this.keywords.find(k => k.content_id === ev.refs!.content_id) : undefined;
      const via = `${SYSTEM_LABEL[ev.source?.system ?? ''] ?? '增长飞轮'}·${ev.type === 'visit.done' ? '线下走访' : CAPTURE_LABEL[String(p.capture_channel ?? 'other')] ?? '其他'}`;
      const leadIn: FlywheelLeadImport = {
        ...(contactId ? { contactId } : {}),
        displayName: typeof ev.contact?.display_name === 'string' ? ev.contact.display_name.slice(0, 60) : '',
        identities, source: kw?.title ? `《${kw.title}》（${via}）` : via,
        ...(typeof p.need === 'string' ? { need: p.need.slice(0, 200) } : {}), ...(typeof p.note === 'string' ? { note: p.note.slice(0, 200) } : {}),
      };
      const r = await c.importLead(leadIn);
      this.afterLink(r);
      if (r.status === 'suspect' && !this.state.suspects.some(s => s.candidateId === r.candidateId && (s.contactId ?? s.displayName) === (contactId ?? leadIn.displayName))) {
        this.state.suspects.push({ id: randomUUID().slice(0, 12), at: new Date(this.now()).toISOString(), displayName: leadIn.displayName || '（没有名字）', candidateId: r.candidateId, candidateName: r.candidateName, ...(contactId ? { contactId } : {}), via, lead: leadIn });
        this.state.suspects = this.state.suspects.slice(-50);
        try { this.deps.notify?.('增长飞轮：可能是同一位客户', `「${leadIn.displayName || '一位客户'}」（${via}）和你档案里的「${r.candidateName}」名字一样，但没有手机号等能确认的信息。咔哒没有合并，请在「插件 → 连接增长飞轮」里确认。`); } catch { /* optional */ }
      }
      return;
    }
    if (FEED_TYPES_SALES.includes(ev.type) && this.settings.receiveSalesStages) {
      const p = ev.payload ?? {};
      await c.applySales({ ...(contactId ? { contactId } : {}), identities, type: ev.type, ...(typeof p.to === 'string' ? { to: p.to } : {}), ...(typeof p.due_at === 'string' ? { dueAt: p.due_at } : {}) });
    }
  }

  // ——— files ———

  private async atomic(file: string, text: string) {
    const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
    try { await writeFile(tmp, text, { encoding: 'utf8', mode: 0o600 }); await rename(tmp, file); } catch (e) { await unlink(tmp).catch(() => {}); throw e; }
  }
  private saveConfig() { return this.atomic(this.files.config, JSON.stringify(this.settings, null, 2)).catch(() => {}); }
  /**
   * One write at a time; each write takes its snapshot when it starts, so an older snapshot can never land after a
   * newer one (the race of the first version). Requests made while a write is waiting share that write.
   */
  persist(): Promise<void> {
    if (this.writeQueued) return this.writeChain;
    this.writeQueued = true;
    const run = this.writeChain.then(async () => {
      this.writeQueued = false;
      const outbox = this.outbox.map(i => JSON.stringify(i)).join('\n') + (this.outbox.length ? '\n' : '');
      const state = JSON.stringify(this.state);
      const sent = this.sentAppend.splice(0);
      await mkdir(this.deps.dir, { recursive: true });
      await this.atomic(this.files.outbox, outbox);
      await this.atomic(this.files.state, state);
      if (sent.length) await appendFile(this.files.sent, sent.join('\n') + '\n', { encoding: 'utf8', mode: 0o600 });
    });
    this.writeChain = run.catch(() => {});
    return run.catch(() => {});
  }
  private pruneSent() {
    const run = this.writeChain.then(async () => {
      let text = ''; try { text = await readFile(this.files.sent, 'utf8'); } catch { return; }
      const cutoff = this.now() - SENT_KEEP_MS;
      const keep = text.split('\n').filter(l => { if (!l.trim()) return false; try { return Date.parse(JSON.parse(l).sentAt) >= cutoff; } catch { return false; } });
      await this.atomic(this.files.sent, keep.length ? keep.join('\n') + '\n' : '');
    });
    this.writeChain = run.catch(() => {});
    return run.catch(() => {});
  }
}

function pick(raw: Record<string, unknown>): Partial<FlywheelSettings> {
  const out: Partial<FlywheelSettings> = {};
  if (typeof raw.hubUrl === 'string') { try { out.hubUrl = validHubUrl(raw.hubUrl); } catch { out.hubUrl = ''; } }
  if (typeof raw.workspaceId === 'string' && WORKSPACE_ID.test(raw.workspaceId)) out.workspaceId = raw.workspaceId;
  for (const k of ['sendReceptionEvents', 'sendProfileUpdates', 'receiveExternalLeads', 'receiveSalesStages'] as const) if (typeof raw[k] === 'boolean') out[k] = raw[k] as boolean;
  if (typeof raw.consentAt === 'string' && Number.isFinite(Date.parse(raw.consentAt))) out.consentAt = raw.consentAt;
  return out;
}
