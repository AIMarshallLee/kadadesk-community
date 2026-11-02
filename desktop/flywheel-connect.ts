/**
 * Flywheel Connect Manager (连接增长飞轮插件核心服务)
 * 负责发件箱持久化、避让策略调度、网络重试、扣词缓存与上下文注入、外部线索与销售进展同步
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { CustomerProfile, CustomerFact } from '../shared/customers';
import type { DailyHealthFacts } from '../shared/flywheel/types';
import type { ReceptionEvent } from './replies-contract';
import {
  type FlywheelEnvelope,
  type FlywheelPluginConfig,
  type FlywheelPluginState,
  type FlywheelKeywordItem,
} from '../shared/flywheel/types';
import {
  buildFlywheelContact,
  mapConversationStarted,
  mapConversationFirstReply,
  mapConversationHandoff,
  mapContactProfiled,
  mapLeadCaptured,
  mapDailyHealth,
  DEFAULT_WORKSPACE_ID,
} from '../shared/flywheel/mapping';
import { matchKeywords, type KeywordMatchResult } from '../shared/flywheel/keywords';

export interface OutboxItem {
  id: string;
  envelope: FlywheelEnvelope<any>;
  tries: number;
  nextRetryAt: number;
  addedAt: string;
}

export interface FlywheelManagerDeps {
  userDataDir: string;
  customerWaiting: () => boolean;
  receptionRunning: () => boolean;
  resourceLevel?: () => 'idle' | 'normal' | 'struggling';
  getProfile?: (name: string, channel?: 'desk' | 'phone') => CustomerProfile | undefined;
  getProfileById?: (id: string) => CustomerProfile | undefined;
  getAllProfiles?: () => CustomerProfile[];
  updateProfile?: (profile: CustomerProfile) => Promise<void> | void;
  upsertExternalLead?: (lead: {
    displayName: string;
    identities: Array<{ type: string; value: string }>;
    source?: string;
    need?: string;
    note?: string;
  }) => Promise<{ merged: boolean; profileId: string }>;
  updateSalesStage?: (update: {
    profileId?: string;
    contactId?: string;
    identities?: Array<{ type: string; value: string }>;
    stage?: string;
    stageName?: string;
    dealStatus?: 'open' | 'won' | 'lost';
    nextFollowupAt?: string;
  }) => Promise<void>;
  getDailyHealth?: () => DailyHealthFacts | undefined;
  now?: () => number;
  fetch?: typeof globalThis.fetch;
}

const DEFAULT_CONFIG: FlywheelPluginConfig = {
  enabled: false,
  hubUrl: '',
  apiKey: '',
  workspaceId: DEFAULT_WORKSPACE_ID,
  sendReceptionEvents: true,
  sendProfileUpdates: true,
  receiveExternalLeads: true,
  receiveSalesStages: true,
};

const DEFAULT_STATE: FlywheelPluginState = {
  sentCount: 0,
  pendingCount: 0,
  errorCount: 0,
};

export class FlywheelManager {
  private dir: string;
  private configFile: string;
  private stateFile: string;
  private outboxFile: string;
  private keywordsFile: string;

  private config: FlywheelPluginConfig = { ...DEFAULT_CONFIG };
  private state: FlywheelPluginState = { ...DEFAULT_STATE };
  private outbox: OutboxItem[] = [];
  private keywords: FlywheelKeywordItem[] = [];

  private timer?: NodeJS.Timeout;
  private sending = false;
  private syncing = false;
  private lastSyncAt = 0;
  private initialized = false;

  private conversationLastActivity = new Map<string, number>();
  private knownLeadProfiles = new Set<string>();

  constructor(private deps: FlywheelManagerDeps) {
    this.dir = join(deps.userDataDir, 'flywheel');
    this.configFile = join(this.dir, 'config.json');
    this.stateFile = join(this.dir, 'state.json');
    this.outboxFile = join(this.dir, 'outbox.jsonl');
    this.keywordsFile = join(this.dir, 'keywords.json');
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private getFetch(): typeof globalThis.fetch {
    return this.deps.fetch || globalThis.fetch.bind(globalThis);
  }

  public async init(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.dir, { recursive: true });

    try {
      if (existsSync(this.configFile)) {
        const raw = JSON.parse(await readFile(this.configFile, 'utf8'));
        this.config = { ...DEFAULT_CONFIG, ...raw };
      }
    } catch {
      this.config = { ...DEFAULT_CONFIG };
    }

    try {
      if (existsSync(this.stateFile)) {
        const raw = JSON.parse(await readFile(this.stateFile, 'utf8'));
        this.state = { ...DEFAULT_STATE, ...raw };
      }
    } catch {
      this.state = { ...DEFAULT_STATE };
    }

    try {
      if (existsSync(this.keywordsFile)) {
        const raw = JSON.parse(await readFile(this.keywordsFile, 'utf8'));
        this.keywords = Array.isArray(raw) ? raw : (raw.keywords || []);
      }
    } catch {
      this.keywords = [];
    }

    await this.loadOutbox();

    this.initialized = true;
    this.startSchedule();
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private startSchedule(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      void this.tick().catch(() => {});
    }, 30000);
    (this.timer as { unref?: () => void })?.unref?.();
  }

  public async tick(): Promise<void> {
    if (!this.config.enabled) return;

    if (this.shouldBackOff()) {
      return;
    }

    await this.flushOutbox();

    if (this.now() - this.lastSyncAt >= 5 * 60000) {
      await this.syncKeywordsAndFeed();
    }
  }

  public shouldBackOff(): boolean {
    if (this.deps.customerWaiting && this.deps.customerWaiting()) {
      return true;
    }
    if (this.deps.resourceLevel && this.deps.resourceLevel() === 'struggling') {
      return true;
    }
    return false;
  }

  private async loadOutbox(): Promise<void> {
    this.outbox = [];
    try {
      if (existsSync(this.outboxFile)) {
        const text = await readFile(this.outboxFile, 'utf8');
        const lines = text.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const item = JSON.parse(trimmed) as OutboxItem;
            if (item && item.id && item.envelope) {
              this.outbox.push(item);
            }
          } catch {
            // ignore broken line
          }
        }
      }
    } catch {
      this.outbox = [];
    }
    this.state.pendingCount = this.outbox.length;
    await this.saveState();
  }

  private async persistOutbox(): Promise<void> {
    const text = this.outbox.map(item => JSON.stringify(item)).join('\n') + (this.outbox.length ? '\n' : '');
    const tmp = `${this.outboxFile}.${process.pid}.${Math.random().toString(36).slice(2, 6)}.tmp`;
    try {
      await writeFile(tmp, text, 'utf8');
      await rename(tmp, this.outboxFile);
    } catch (e) {
      await unlink(tmp).catch(() => {});
      throw e;
    }
    this.state.pendingCount = this.outbox.length;
    await this.saveState();
  }

  private async saveState(): Promise<void> {
    const tmp = `${this.stateFile}.${process.pid}.${Math.random().toString(36).slice(2, 6)}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(this.state, null, 2), 'utf8');
      await rename(tmp, this.stateFile);
    } catch {
      await unlink(tmp).catch(() => {});
    }
  }

  private async saveConfig(): Promise<void> {
    const tmp = `${this.configFile}.${process.pid}.${Math.random().toString(36).slice(2, 6)}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(this.config, null, 2), 'utf8');
      await rename(tmp, this.configFile);
    } catch {
      await unlink(tmp).catch(() => {});
    }
  }

  private async saveKeywords(): Promise<void> {
    const tmp = `${this.keywordsFile}.${process.pid}.${Math.random().toString(36).slice(2, 6)}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(this.keywords, null, 2), 'utf8');
      await rename(tmp, this.keywordsFile);
    } catch {
      await unlink(tmp).catch(() => {});
    }
  }

  public getConfig(): FlywheelPluginConfig {
    return { ...this.config };
  }

  public async setConfig(patch: Partial<FlywheelPluginConfig>): Promise<FlywheelPluginConfig> {
    this.config = { ...this.config, ...patch };
    await this.saveConfig();
    return this.getConfig();
  }

  public getState(): FlywheelPluginState {
    return { ...this.state };
  }

  public async clearOutbox(): Promise<void> {
    this.outbox = [];
    await this.persistOutbox();
  }

  public async testConnection(hubUrl?: string, apiKey?: string): Promise<{ ok: boolean; message: string }> {
    const url = (hubUrl || this.config.hubUrl || '').replace(/\/+$/, '');
    const key = apiKey || this.config.apiKey;
    if (!url) return { ok: false, message: '请先填写事件中心地址' };
    if (!key) return { ok: false, message: '请先填写接口密钥' };

    try {
      const fetcher = this.getFetch();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetcher(`${url}/api/flywheel/health`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${key}`,
        },
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));

      if (res.status === 200) {
        return { ok: true, message: '连接成功，服务运行正常' };
      }
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: '密钥不正确或没有权限，请检查' };
      }
      return { ok: false, message: `服务响应异常 (HTTP ${res.status})` };
    } catch (e: any) {
      if (e?.name === 'AbortError') return { ok: false, message: '连接超时，请检查网络或地址' };
      return { ok: false, message: `连接失败：${e?.message || '网络不通'}` };
    }
  }

  public async enqueue(envelope: FlywheelEnvelope<any>): Promise<boolean> {
    if (!this.config.enabled) return false;

    if (envelope.type.startsWith('conversation.') && !this.config.sendReceptionEvents) {
      return false;
    }
    if (envelope.type === 'contact.profiled' && !this.config.sendProfileUpdates) {
      return false;
    }

    const item: OutboxItem = {
      id: envelope.event_id,
      envelope,
      tries: 0,
      nextRetryAt: 0,
      addedAt: new Date(this.now()).toISOString(),
    };

    this.outbox.push(item);
    await this.persistOutbox();
    return true;
  }

  public async flushOutbox(): Promise<number> {
    if (!this.config.enabled || !this.config.hubUrl || !this.config.apiKey) return 0;
    if (this.sending || this.outbox.length === 0) return 0;

    this.sending = true;
    try {
      const now = this.now();
      const readyItems = this.outbox.filter(item => item.nextRetryAt <= now).slice(0, 100);
      if (readyItems.length === 0) return 0;

      const url = `${this.config.hubUrl.replace(/\/+$/, '')}/api/flywheel/events`;
      const fetcher = this.getFetch();
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 15000);

      let response: Response;
      try {
        response = await fetcher(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify({
            events: readyItems.map(item => item.envelope),
          }),
          signal: ctrl.signal,
        });
      } catch (err: any) {
        this.handleNetworkFailure(readyItems, err?.message || '网络连接超时');
        await this.persistOutbox();
        return 0;
      } finally {
        clearTimeout(timeout);
      }

      if (response.status === 200) {
        let data: any = {};
        try {
          data = await response.json();
        } catch {
          // empty
        }

        const acceptedIds = new Set<string>();
        if (Array.isArray(data.accepted)) {
          for (const item of data.accepted) {
            if (typeof item === 'string') acceptedIds.add(item);
            else if (item?.event_id) acceptedIds.add(item.event_id);
          }
        }
        if (Array.isArray(data.duplicates)) {
          for (const id of data.duplicates) acceptedIds.add(id);
        }

        if (data.contact_mapping && typeof data.contact_mapping === 'object' && this.deps.getProfileById && this.deps.updateProfile) {
          for (const [localId, contactId] of Object.entries(data.contact_mapping)) {
            if (localId && typeof contactId === 'string') {
              const p = this.deps.getProfileById(localId);
              if (p && p.flywheelContactId !== contactId) {
                p.flywheelContactId = contactId;
                await this.deps.updateProfile(p);
              }
            }
          }
        }

        const readyIdSet = new Set(readyItems.map(x => x.id));
        this.outbox = this.outbox.filter(item => {
          if (!readyIdSet.has(item.id)) return true;
          return !acceptedIds.has(item.id);
        });

        if (Array.isArray(data.rejected)) {
          for (const rej of data.rejected) {
            const rejId = rej?.event_id;
            if (rejId) {
              this.outbox = this.outbox.filter(x => x.id !== rejId);
              this.state.errorCount++;
            }
          }
        }

        const count = acceptedIds.size || readyItems.length;
        this.state.sentCount += count;
        this.state.lastSuccessAt = new Date(this.now()).toISOString();
        this.state.lastError = undefined;

        await this.persistOutbox();
        return count;
      } else if (response.status === 401 || response.status === 403) {
        this.state.lastError = '密钥不对或无权限，请重新检查粘贴';
        this.state.errorCount++;
        for (const item of readyItems) {
          item.nextRetryAt = now + 600000;
        }
        await this.persistOutbox();
        return 0;
      } else if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        this.state.lastError = `数据格式错误被拒 (HTTP ${response.status})，已丢弃`;
        this.state.errorCount += readyItems.length;
        const readyIdSet = new Set(readyItems.map(x => x.id));
        this.outbox = this.outbox.filter(x => !readyIdSet.has(x.id));
        await this.persistOutbox();
        return 0;
      } else {
        this.handleNetworkFailure(readyItems, `服务端暂时繁忙 (HTTP ${response.status})`);
        await this.persistOutbox();
        return 0;
      }
    } finally {
      this.sending = false;
    }
  }

  private handleNetworkFailure(items: OutboxItem[], reason: string): void {
    const now = this.now();
    this.state.lastError = '事件中心暂时连不上，咔哒会自动重试，客户接待不受影响';

    const intervals = [60000, 300000, 1800000, 7200000];

    for (const item of items) {
      item.tries++;
      const idx = Math.min(item.tries - 1, intervals.length - 1);
      const delay = intervals[idx] || 60000;
      item.nextRetryAt = now + delay;
    }
  }

  public async syncKeywordsAndFeed(): Promise<void> {
    if (!this.config.enabled || !this.config.hubUrl || !this.config.apiKey) return;
    if (this.syncing) return;

    this.syncing = true;
    this.lastSyncAt = this.now();

    try {
      const fetcher = this.getFetch();
      const baseUrl = this.config.hubUrl.replace(/\/+$/, '');

      try {
        const kwRes = await fetcher(`${baseUrl}/api/flywheel/keywords`, {
          headers: { Authorization: `Bearer ${this.config.apiKey}` },
        });
        if (kwRes.status === 200) {
          const kwData = await kwRes.json();
          const items = Array.isArray(kwData) ? kwData : (kwData.keywords || []);
          this.keywords = items;
          this.state.lastKeywordsSyncAt = new Date(this.now()).toISOString();
          await this.saveKeywords();
        }
      } catch {
        // error tolerance
      }

      if (this.config.receiveExternalLeads || this.config.receiveSalesStages) {
        try {
          const cursor = this.state.lastFeedCursor || '';
          const feedUrl = `${baseUrl}/api/flywheel/feed?after=${encodeURIComponent(cursor)}&types=lead.created,lead.touched,visit.done,stage.changed,followup.scheduled,deal.lost,contract.signed&limit=100`;
          const feedRes = await fetcher(feedUrl, {
            headers: { Authorization: `Bearer ${this.config.apiKey}` },
          });

          if (feedRes.status === 200) {
            const feedData = await feedRes.json();
            const events: FlywheelEnvelope<any>[] = Array.isArray(feedData) ? feedData : (feedData.events || []);

            for (const ev of events) {
              if (ev?.source?.system === 'kadadesk') continue;

              if (
                this.config.receiveExternalLeads &&
                ['lead.created', 'lead.touched', 'visit.done'].includes(ev.type) &&
                this.deps.upsertExternalLead
              ) {
                const displayName = ev.contact?.display_name || '外部线索';
                const identities = ev.contact?.identities || [];
                const need = ev.payload?.need;
                const source = ev.refs?.content_id ? `外部内容: ${ev.refs.content_id}` : (ev.payload?.platform || '线上线索');
                await this.deps.upsertExternalLead({
                  displayName,
                  identities,
                  source,
                  need,
                  note: ev.payload?.note,
                });
              }

              if (
                this.config.receiveSalesStages &&
                ['stage.changed', 'followup.scheduled', 'deal.lost', 'contract.signed'].includes(ev.type) &&
                this.deps.updateSalesStage
              ) {
                let dealStatus: 'open' | 'won' | 'lost' | undefined;
                if (ev.type === 'contract.signed') dealStatus = 'won';
                else if (ev.type === 'deal.lost') dealStatus = 'lost';
                else dealStatus = 'open';

                await this.deps.updateSalesStage({
                  profileId: ev.contact?.local_id,
                  contactId: ev.contact?.contact_id || undefined,
                  identities: ev.contact?.identities,
                  stage: ev.payload?.to || ev.payload?.stage,
                  stageName: ev.payload?.stage_name || ev.payload?.to,
                  dealStatus,
                  nextFollowupAt: ev.type === 'followup.scheduled' ? ev.payload?.due_at : undefined,
                });
              }
            }

            if (feedData.next_cursor) {
              this.state.lastFeedCursor = feedData.next_cursor;
              await this.saveState();
            }
          }
        } catch {
          // error tolerance
        }
      }
    } finally {
      this.syncing = false;
    }
  }

  public matchKeywordForReply(conversationName: string, text: string): KeywordMatchResult | null {
    if (!text || this.keywords.length === 0) return null;
    const res = matchKeywords(text, this.keywords);
    if (!res.matched) return null;

    const profile = this.deps.getProfile ? this.deps.getProfile(conversationName) : undefined;
    if (profile) {
      const isFirst = !this.knownLeadProfiles.has(profile.id);
      this.knownLeadProfiles.add(profile.id);

      const contact = buildFlywheelContact(profile, 'customer_initiated', new Date(this.now()).toISOString());
      const leadEvent = mapLeadCaptured({
        contact,
        isFirstTime: isFirst,
        captureChannel: 'keyword',
        contentId: res.item.content_id,
        keyword: res.keyword,
        need: res.item.title,
        workspaceId: this.config.workspaceId,
      });
      void this.enqueue(leadEvent);

      if (this.deps.updateProfile) {
        const hasSource = profile.facts?.some(f => f.field === 'source' && f.value.includes(res.item.title));
        if (!hasSource) {
          const at = new Date(this.now()).toISOString();
          profile.facts.push({
            field: 'source',
            value: res.sourceFactValue,
            source: 'customer',
            at,
          });
          profile.updatedAt = at;
          void Promise.resolve(this.deps.updateProfile(profile)).catch(() => {});
        }
      }
    }

    return res;
  }

  public async handleReceptionEvent(event: ReceptionEvent): Promise<void> {
    if (!this.config.enabled) return;

    const convName = (event as any).conversation || '';
    const profile = this.deps.getProfile ? this.deps.getProfile(convName) : undefined;
    if (!profile) return;

    const contact = buildFlywheelContact(profile, 'customer_initiated', (event as any).at);

    switch (event.kind) {
      case 'incoming': {
        const lastActivity = this.conversationLastActivity.get(convName) || 0;
        const now = this.now();
        if (now - lastActivity >= 24 * 3600000 || event.first) {
          const startedEvent = mapConversationStarted({
            contact,
            channel: 'wechat',
            firstMessageAt: event.at,
            occurredAt: event.at,
            workspaceId: this.config.workspaceId,
          });
          await this.enqueue(startedEvent);
        }
        this.conversationLastActivity.set(convName, now);
        break;
      }

      case 'reply-sent': {
        this.conversationLastActivity.set(convName, this.now());
        if (event.firstInConversation) {
          const firstReplyEvent = mapConversationFirstReply({
            contact,
            latencySeconds: event.latencySeconds || 0,
            by: event.by || 'ai',
            mode: event.mode || 'auto',
            occurredAt: event.at,
            workspaceId: this.config.workspaceId,
          });
          await this.enqueue(firstReplyEvent);
        }
        break;
      }

      case 'handoff': {
        const handoffEvent = mapConversationHandoff({
          contact,
          detail: event.detail,
          topic: event.text ? event.text.slice(0, 50) : undefined,
          occurredAt: event.at,
          workspaceId: this.config.workspaceId,
        });
        await this.enqueue(handoffEvent);
        break;
      }

      case 'profile-updated': {
        const profiledEvent = mapContactProfiled({
          contact,
          changedFacts: (event as any).changedFacts || [],
          occurredAt: event.at,
          workspaceId: this.config.workspaceId,
        });
        if (profiledEvent) {
          await this.enqueue(profiledEvent);
        }
        break;
      }

      case 'lead-captured': {
        const isFirst = !this.knownLeadProfiles.has(profile.id);
        this.knownLeadProfiles.add(profile.id);
        const leadEvent = mapLeadCaptured({
          contact,
          isFirstTime: isFirst,
          captureChannel: event.captureChannel,
          contentId: (event as any).detail?.contentId,
          keyword: (event as any).detail?.keyword,
          need: (event as any).detail?.need,
          note: (event as any).detail?.note,
          occurredAt: event.at,
          workspaceId: this.config.workspaceId,
        });
        await this.enqueue(leadEvent);
        break;
      }
    }
  }

  public async reportDailyHealth(date: string, facts: DailyHealthFacts): Promise<boolean> {
    if (!this.config.enabled) return false;
    const envelope = mapDailyHealth({
      date,
      facts,
      workspaceId: this.config.workspaceId,
    });
    return this.enqueue(envelope);
  }
}
