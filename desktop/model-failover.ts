// 模型池 + 备用模型. Reception does not depend on one model:
// - members: the main model plus other models of the same service that passed the picture test (自动挑选), and
//   finally the owner's backup service (used only when every other member is resting).
// - Each call goes to a healthy member; among members of similar speed the calls take turns, so no single model's
//   quota takes all the load. Speed is learned from real calls (moving average).
// - A member that is rate limited (HTTP 429), overloaded (5xx), unreachable or too slow rests for a while
//   (3, 6, then up to 15 min, or the provider's Retry-After) and the same request goes to the next member.
// - A member that is slow on this request (no answer after ~2× its usual time, 9–20 s) gets company: the same request
//   also goes to the next healthy member and the first answer is used; the other request is cancelled. One stuck
//   relay call then costs ~10 s instead of a full 45 s timeout plus a retry. Screen reads (readScene, readNavigation,
//   readHeaderTitle, readSearch) get company sooner: after ~6 s (1.3× that method's usual time, 4–8 s).
// - A member that lost such a race (it was still working when the other one answered) is "lagging" for 2 minutes:
//   healthy members, and then the backup, are asked first while it lags. A rate limit (HTTP 429) rests the member
//   for a short while (1, 2, then up to 5 min, or the provider's Retry-After).
// - An answer that is not valid JSON at all (VISION_*_JSON) is a glitch of that model: the same request goes once to
//   another member, without resting the first.
// Only failures of the model service itself move a request: a reply the model wrote, a screen it could not read,
// a cancelled request or a check that failed are never retried elsewhere.

export type FailoverEvent = { kind: 'switched'; reason: string; minutes: number } | { kind: 'restored' };
export type PoolMember<T> = { id: string; model: T; fallback?: boolean };

/** The service failed, not the request: worth one try on another member. */
export function serviceFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'TemporaryModelReadError') return true;
  // One model of the pool answered with broken JSON (a thinking model's stray text): another member may answer cleanly.
  if (jsonGlitch(error)) return true;
  return /^视觉模型请求失败/.test(error.message) && !/HTTP 4(00|13|22)\b/.test(error.message);
}
/** The model answered with text that is not JSON at all: worth one try elsewhere, but no reason to rest the member. */
export function jsonGlitch(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'SyntaxError' && /JSON/.test(error.message)) return true;
  return error.name === 'VisionReadError' && /\[VISION_(?:[A-Z]+_)?JSON\]/.test(error.message);
}
const rateLimited = (error: unknown) => error instanceof Error && /HTTP 429|限流/.test(error.message);
function reasonOf(error: unknown): string {
  const text = error instanceof Error ? error.message : '';
  if (/HTTP 429|限流/.test(text)) return '主模型调用太频繁，被服务商限流';
  if (/超时/.test(text)) return '主模型响应太慢';
  if (/HTTP 5\d\d|暂时不可用/.test(text)) return '主模型服务暂时不可用';
  if (/HTTP 40[13]|密钥/.test(text)) return '主模型的密钥或权限没通过';
  return '主模型暂时连不上';
}

/** Shared by every model object built for the same member, so a new reception session keeps what was learned. */
const cooling = new Map<string, { until: number; strikes: number }>();
const speed = new Map<string, number>();
/** Usual time of one member for one method (member id + NUL + method), for the hedge wait. */
const methodSpeed = new Map<string, number>();
/** Members that recently lost a hedge race (still busy when another member answered): asked last until then. */
const lagging = new Map<string, number>();
const BASE_MS = 3 * 60_000, MAX_MS = 15 * 60_000, LIMIT_BASE_MS = 60_000, LIMIT_MAX_MS = 5 * 60_000, LAG_MS = 2 * 60_000;

/** Wait this long for a member before asking another one too: about twice its usual time, 9–20 s. */
const defaultHedge = (usual: number | undefined) => usual === undefined ? 15_000 : Math.min(20_000, Math.max(9_000, usual * 2));
/** Screen reads gate every reply: ask a second member after ~6 s (1.3× that read's usual time, 4–8 s). */
export const screenReadHedge = (usual: number | undefined) => usual === undefined ? 6_000 : Math.min(8_000, Math.max(4_000, usual * 1.3));
const SCREEN_READS = /^read(Scene|Navigation|HeaderTitle|Search)$/;
let hedgeHook: ((id: string) => void) | undefined;
/** Diagnostics hook (main process): which member was asked as a second opinion. */
export function onModelHedge(fn: (id: string) => void) { hedgeHook = fn; }
const recordHedge = (id: string) => { try { hedgeHook?.(id); } catch { /* diagnostics only */ } };

export function withModelPool<T extends object>(members: PoolMember<T>[], options: { now?: () => number; onEvent?: (event: FailoverEvent) => void; hedgeMs?: (usualMs: number | undefined, method: string) => number } = {}): T {
  const unique = members.filter((m, i) => members.findIndex(x => x.id === m.id) === i);
  if (unique.length <= 1) return unique[0]!.model;
  const now = options.now ?? Date.now;
  const notify = (event: FailoverEvent) => { try { options.onEvent?.(event); } catch { /* notification never changes the read */ } };
  const resting = (id: string) => { const c = cooling.get(id); return !!c && now() < c.until; };
  const lags = (id: string) => { const until = lagging.get(id); return until !== undefined && now() < until; };
  const mainId = unique[0]!.id;
  const rest = (id: string, error: unknown) => {
    const prev = cooling.get(id), strikes = Math.min((prev?.strikes ?? 0) + 1, 3);
    const retry = error instanceof Error && typeof (error as { retryAfterMs?: unknown }).retryAfterMs === 'number' ? (error as unknown as { retryAfterMs: number }).retryAfterMs : 0;
    // A rate limit passes quickly (the next minute's quota): a short rest, unless the provider says otherwise.
    const ms = rateLimited(error) ? Math.min(Math.max(Math.min(LIMIT_BASE_MS * 2 ** (strikes - 1), LIMIT_MAX_MS), retry), MAX_MS) : Math.min(Math.max(BASE_MS * 2 ** (strikes - 1), retry), MAX_MS);
    cooling.set(id, { until: now() + ms, strikes });
    if (id === mainId) notify({ kind: 'switched', reason: reasonOf(error), minutes: Math.round(ms / 60_000) });
  };
  const learn = (map: Map<string, number>, key: string, ms: number) => { const old = map.get(key); map.set(key, old === undefined ? ms : old * 0.7 + ms * 0.3); };
  const worked = (id: string, method: string, ms: number) => {
    learn(speed, id, ms); learn(methodSpeed, id + '\0' + method, ms); lagging.delete(id);
    if (cooling.delete(id) && id === mainId) notify({ kind: 'restored' });
  };
  /** A request cancelled because another member answered first: it was at least this slow, and it lags for a while. */
  const slow = (id: string, method: string, ms: number, headStart: boolean) => {
    for (const [map, key] of [[speed, id], [methodSpeed, id + '\0' + method]] as const) { const old = map.get(key); map.set(key, old === undefined ? ms * 1.5 : Math.max(old, old * 0.7 + ms * 1.5 * 0.3)); }
    // Only a member that was asked first and still lost lags; a second opinion cancelled early did nothing wrong.
    if (headStart) lagging.set(id, now() + LAG_MS);
  };
  let turn = 0;
  /** Healthy pool members of similar speed take turns; the backup only when every pool member rests or lags. */
  const pick = (tried: Set<string>): PoolMember<T> | undefined => {
    const open = unique.filter(m => !tried.has(m.id) && !resting(m.id));
    const all = open.filter(m => !m.fallback), spare = open.filter(m => m.fallback);
    // A member that just lost a race is asked after the others (and after a backup that does not lag) for a while.
    const fresh = all.filter(m => !lags(m.id)), freshSpare = spare.filter(m => !lags(m.id));
    const pool = fresh.length ? fresh : freshSpare.length ? [] : all;
    // Everything resting on the first try: ask the main model anyway (it may have recovered early).
    if (!pool.length) return freshSpare[0] ?? spare[0] ?? (tried.size === 0 ? unique[0] : undefined);
    const known = pool.map(m => speed.get(m.id)).filter((v): v is number => v !== undefined);
    const best = known.length ? Math.min(...known) : 0;
    // An unmeasured member is tried once; then only members within 1.5× (+0.5 s) of the fastest share the load.
    const near = pool.filter(m => { const s = speed.get(m.id); return s === undefined || s <= best * 1.5 + 500; });
    return near[turn++ % near.length];
  };
  // A backup is often a free model that serves one request at a time (Zhipu Flash: HTTP 429 code 1302 on a second
  // concurrent call), so calls to fallback members are queued one after another.
  let tail: Promise<unknown> = Promise.resolve();
  const queued = (fn: () => unknown) => { const run = tail.then(() => fn(), () => fn()); tail = run.then(() => {}, () => {}); return run; };
  return new Proxy(unique[0]!.model, {
    get(target, prop, receiver) {
      const main = Reflect.get(target, prop, receiver);
      if (typeof main !== 'function') return main;
      if (unique.some(m => typeof (m.model as Record<PropertyKey, unknown>)[prop] !== 'function')) return main;
      // Only async methods move between members (a synchronous helper keeps returning its value directly).
      if ((main as { constructor?: { name?: string } }).constructor?.name !== 'AsyncFunction') return main;
      return async (...args: unknown[]) => {
        const signalIndex = args.findIndex(a => a && typeof a === 'object' && 'aborted' in (a as object) && 'addEventListener' in (a as object));
        const signal = signalIndex >= 0 ? args[signalIndex] as AbortSignal : undefined;
        const tried = new Set<string>(); let lastError: unknown;
        type Attempt = { member: PoolMember<T>; started: number; controller: AbortController; done: boolean };
        const running: Attempt[] = [];
        return await new Promise<unknown>((resolve, reject) => {
          let settled = false, hedgeTimer: ReturnType<typeof setTimeout> | undefined;
          const finish = (fn: () => void) => { if (settled) return; settled = true; if (hedgeTimer) clearTimeout(hedgeTimer); signal?.removeEventListener('abort', onAbort); fn(); };
          const method = String(prop);
          const cancelOthers = (winner?: Attempt) => { for (const a of running) if (a !== winner && !a.done) { a.done = true; a.controller.abort(); if (winner) slow(a.member.id, method, now() - a.started, a.started <= winner.started && running.indexOf(a) < running.indexOf(winner)); } };
          const onAbort = () => { for (const a of running) a.controller.abort(); finish(() => reject(signal!.reason ?? lastError ?? new Error('已取消'))); };
          signal?.addEventListener('abort', onAbort, { once: true });
          const armHedge = (a: Attempt) => {
            if (hedgeTimer) clearTimeout(hedgeTimer);
            const usual = methodSpeed.get(a.member.id + '\0' + method) ?? (SCREEN_READS.test(method) ? undefined : speed.get(a.member.id));
            const wait = options.hedgeMs ? options.hedgeMs(usual, method) : SCREEN_READS.test(method) ? screenReadHedge(usual) : defaultHedge(usual);
            hedgeTimer = setTimeout(() => { if (!settled && !a.done && running.filter(x => !x.done).length === 1) start(true); }, wait);
          };
          const start = (hedge = false): boolean => {
            const member = pick(tried); if (!member) return false;
            tried.add(member.id);
            const controller = new AbortController();
            const a: Attempt = { member, started: now(), controller, done: false }; running.push(a);
            if (hedge) recordHedge(member.id);
            const callArgs = signalIndex >= 0 ? args.map((v, i) => i === signalIndex ? controller.signal : v) : args;
            const fn = (member.model as Record<PropertyKey, unknown>)[prop] as (...x: unknown[]) => Promise<unknown>;
            const call = () => fn.apply(member.model, callArgs);
            Promise.resolve().then(() => member.fallback ? queued(call) : call()).then(value => {
              if (a.done || settled) return; a.done = true;
              worked(member.id, method, now() - a.started); cancelOthers(a); finish(() => resolve(value));
            }, error => {
              if (a.done || settled) return; a.done = true;
              if (signal?.aborted) { finish(() => reject(error)); return; }
              if (!serviceFailure(error)) { cancelOthers(); finish(() => reject(error)); return; }
              if (!jsonGlitch(error)) rest(member.id, error); lastError = error;
              const others = running.filter(x => !x.done);
              if (others.length) { armHedge(others[0]!); return; }
              if (!start()) finish(() => reject(lastError ?? new Error('视觉模型请求失败、超时或返回内容无效，请检查设置。')));
            });
            armHedge(a);
            return true;
          };
          if (!start()) finish(() => reject(new Error('视觉模型请求失败、超时或返回内容无效，请检查设置。')));
        });
      };
    },
  });
}

/** Main model plus an optional backup (kept for callers that have no pool). */
export function withModelFailover<T extends object>(primary: T, backup: T | undefined, key: string, options: { now?: () => number; onEvent?: (event: FailoverEvent) => void } = {}): T {
  if (!backup) return primary;
  return withModelPool([{ id: key, model: primary }, { id: key + '#backup', model: backup, fallback: true }], options);
}
/** Test hook. */
export function resetModelFailover() { cooling.clear(); speed.clear(); methodSpeed.clear(); lagging.clear(); }
