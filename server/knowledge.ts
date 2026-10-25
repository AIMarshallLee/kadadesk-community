import { createHash, randomUUID } from 'node:crypto';
import type { AppState, Knowledge, Scenario } from '../shared/types';
import type { KnowledgeDraft, KnowledgeEvaluationResult, KnowledgeHit, KnowledgeImportPreview, KnowledgeImportReplaces, KnowledgeReviewResult, KnowledgeSearchInput, KnowledgeSearchResult } from '../shared/knowledge';
import { KNOWLEDGE_IMPORT_LIMITS } from '../shared/knowledge';
import { businessNames, mentionsBusiness, normalizeKnowledgeQuery } from './knowledge-query';
import { knowledgeMarket } from '../shared/customer-market';
import { ApiError } from './api-error';
import type { OrganizedKnowledge, OrganizeSource } from './knowledge-organize';
import { categorize } from '../shared/knowledge-categories';

const scenarios = ['all', 'service', 'community', 'sales', 'recruitment', 'content'];
const norm = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
// Decimal points, minus signs and ranges are part of business facts, not formatting.
const fingerprintText = (value: string) => norm(value).replace(/\s+/g, '').replace(/[?？。!！]+$/, '');
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max: number, required = false): value is string => typeof value === 'string' && value.length <= max && (!required || !!value.trim());
const strings = (value: unknown, count: number, length: number): value is string[] => Array.isArray(value) && value.length <= count && value.every(item => text(item, length, true));
export const knowledgeAvailable = (item: Knowledge) => item.enabled && item.reviewStatus !== 'pending';
export function knowledgeMetadataValid(item: Knowledge) {
  return (item.question === undefined || text(item.question, 2000)) && (item.aliases === undefined || strings(item.aliases, 30, 500))
    && (item.scenario === undefined || scenarios.includes(item.scenario)) && (item.source === undefined || text(item.source, 200))
    && (item.sourceLocator === undefined || text(item.sourceLocator, 300)) && (item.importId === undefined || text(item.importId, 100, true))
    && (item.reviewStatus === undefined || ['pending', 'approved'].includes(item.reviewStatus))
    && (item.approvedAt === undefined || text(item.approvedAt, 50) && Number.isFinite(Date.parse(item.approvedAt)))
    && (item.supersedes === undefined || strings(item.supersedes, 20, 100))
    && (item.heldForReview === undefined || item.heldForReview === true)
    && !(item.reviewStatus === 'pending' && item.enabled);
}
export function readKnowledgeDraft(raw: unknown): KnowledgeDraft {
  if (!object(raw) || !text(raw.title, 200, true) || !text(raw.content, 20000, true) || !strings(raw.tags, 20, 100)
    || (raw.question !== undefined && !text(raw.question, 2000)) || (raw.aliases !== undefined && !strings(raw.aliases, 30, 500))
    || (raw.source !== undefined && !text(raw.source, 200)) || (raw.sourceLocator !== undefined && !text(raw.sourceLocator, 300))
    || (raw.scenario !== undefined && !scenarios.includes(raw.scenario as string))) throw new ApiError(400, '知识条目无效：请检查标题、正文、相似问法、来源、标签和场景');
  return { title: raw.title.trim(), content: raw.content.trim(), tags: [...new Set(raw.tags.map(t => t.trim()))],
    question: typeof raw.question === 'string' ? raw.question.trim() : '', aliases: [...new Set((raw.aliases as string[] | undefined ?? []).map(t => t.trim()))], scenario: (raw.scenario ?? 'all') as Scenario | 'all',
    ...(typeof raw.source === 'string' ? { source: raw.source.trim() } : {}), ...(typeof raw.sourceLocator === 'string' ? { sourceLocator: raw.sourceLocator.trim() } : {}) };
}
/**
 * Identity of a fact: its question (when it has one) and its normalized content. The title and the position in the
 * source file are deliberately left out, so re-importing an edited document recognizes every unchanged fact.
 */
export function knowledgeFingerprint(item: KnowledgeDraft) {
  return createHash('sha256').update(JSON.stringify([fingerprintText(item.question || ''), fingerprintText(item.content), item.scenario || 'all', businessNames(item.tags).sort(), knowledgeMarket(item)])).digest('hex');
}
/** Industry templates mark what the owner still has to fill in with 【…】; such text must never reach a customer. */
export const UNFILLED_PLACEHOLDER = /【[^】]*】/;
export const unfilledPlaceholder = (item: Pick<Knowledge, 'title' | 'content' | 'question'>) => UNFILLED_PLACEHOLDER.exec(`${item.title}\n${item.question ?? ''}\n${item.content}`)?.[0];
const questionKey = (item: Pick<Knowledge, 'question' | 'title'>) => fingerprintText(item.question || item.title);
/** Same question, same business/market/scenario, different answer: two approved entries would contradict each other. */
export function contradicts(item: Knowledge, other: Knowledge) {
  return other.id !== item.id
    && (!businessNames(other.tags).length || !businessNames(item.tags).length || businessNames(other.tags).some(name => businessNames(item.tags).includes(name)))
    && (knowledgeMarket(other) === 'unknown' || knowledgeMarket(item) === 'unknown' || knowledgeMarket(other) === knowledgeMarket(item))
    && (other.scenario === item.scenario || !other.scenario || !item.scenario || other.scenario === 'all' || item.scenario === 'all')
    && questionKey(other) === questionKey(item) && fingerprintText(other.content) !== fingerprintText(item.content);
}

const stopTerms = new Set(['你好', '您好', '请问', '一下', '可以', '可不', '能不', '不能', '怎么', '怎样', '什么', '你们', '我们', '这个', '那个', '是否', '的吗', '吗', '的', '是',
  '多少', '这款', '那款', '这种', '现在', '一个', '知道', '想问', '还有', '有没', 'a', 'the', 'is', 'what']);
// Particles and filler: a pair of characters that includes one of them is a word boundary, not a topic.
const FUNCTION_CHARACTERS = /[的是了吗呢啊呀亲能要请问么吧哦嘛哈哇噢]/u;
// Real words that happen to contain one of those characters.
const KEEP_TERMS = new Set(['功能', '性能', '智能', '能力', '需要', '重要', '要求', '主要', '问题', '申请', '邀请', '了解', '亲子']);
/** Model and SKU codes (A025, X9pro, iphone15): strong evidence on their own. */
const SKU = /^(?=.*[a-z])(?=.*\d)[a-z0-9-]{3,}$/;
function queryTerms(query: string) {
  const values = new Set<string>();
  const topic = query.replace(/请问|您好|你好|你们|我们|有哪些|有什么|是什么|会不会|能不能|可不可以|分别|各自|各是|各要|如何|怎么|怎样|何时|是否|能否|可以|吗|呢/g, ' ');
  for (const run of topic.match(/[\p{Script=Han}]+|[a-z0-9]+/gu) ?? []) {
    if (/^[a-z0-9]+$/.test(run)) values.add(run);
    else if (run.length === 1) { if (!FUNCTION_CHARACTERS.test(run)) values.add(run); }
    else for (let i = 0; i < run.length - 1; i++) { const pair = run.slice(i, i + 2); if (KEEP_TERMS.has(pair) || !FUNCTION_CHARACTERS.test(pair)) values.add(pair); }
  }
  // Preserve single-letter product identifiers when they follow Chinese text.
  for (const match of query.matchAll(/[\p{Script=Han}]([a-z])\b/gu)) values.add(`@${match[1]}`);
  return [...values].filter(value => !stopTerms.has(value)).slice(0, 80);
}
/** The meaningful single characters of a short question, for overlap with an entry's question or title. */
const contentCharacters = (value: string) => new Set(Array.from(value.replace(/[^\p{Script=Han}]/gu, '')).filter(c => !FUNCTION_CHARACTERS.test(c) && !'你我他她们这那个有没不就都还也和与或在给把被让'.includes(c)));
const skuTerms = (value: string) => (value.match(/[a-z0-9-]+/g) ?? []).filter(token => SKU.test(token));
const containsTerm = (field: string, term: string) => term.startsWith('@') ? new RegExp(`(^|[^a-z0-9])${term.slice(1)}([^a-z0-9]|$)`).test(field) : SKU.test(term) ? new RegExp(`(^|[^a-z0-9])${term.replace(/[-]/g, '\\-')}([^a-z0-9]|$)`).test(field) : field.includes(term);
export function retrieveKnowledge(knowledge: Knowledge[], input: KnowledgeSearchInput): KnowledgeSearchResult {
  if (!object(input) || !text(input.query, 4000, true) || (input.scenario !== undefined && !scenarios.includes(input.scenario))
    || (input.ids !== undefined && !strings(input.ids, 1000, 200)) || ('includePending' in input)
    || (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 80))) throw new ApiError(400, '请输入 1–4000 字的测试问题并选择有效场景');
  const limit = input.limit ?? 5;
  const query = normalizeKnowledgeQuery(input.query); const allowed = input.ids === undefined ? undefined : new Set(input.ids);
  const eligible = knowledge.filter(item => knowledgeAvailable(item) && (!allowed || allowed.has(item.id))
    && (!input.scenario || input.scenario === 'all' || !item.scenario || item.scenario === 'all' || item.scenario === input.scenario));
  const names = [...new Set(eligible.flatMap(item => businessNames(item.tags)))];
  const named = names.filter(name => mentionsBusiness(norm(input.query), name));
  // Aliases of the same business are stored together on a reviewed knowledge item.
  const selectedNames = new Set(eligible.filter(item => businessNames(item.tags).some(name => named.includes(name))).flatMap(item => businessNames(item.tags)));
  const scoped = named.length ? eligible.filter(item => businessNames(item.tags).some(name => selectedNames.has(name))) : eligible;
  let topic = query;
  for (const name of named.sort((a, b) => b.length - a.length)) topic = topic.replaceAll(name, ' ');
  const clauses = topic.split(/[，,；;？?\n]|以及|并且/).map(part => part.trim()).filter(Boolean).slice(0, 4);
  if (clauses.length > 1) {
    const parts = clauses.map(part => retrieveKnowledge(scoped, { ...input, query: part }));
    const hits = [...new Map(parts.flatMap(part => part.hits.slice(0, Math.max(2, Math.ceil(limit / clauses.length)))).map(hit => [hit.id, hit])).values()].slice(0, limit);
    return { query: input.query.trim(), hits, status: hits.length ? 'matched' : 'no_match', note: '已分别检索多个问题；有命中不代表每个问题都有依据，请逐项核对。' };
  }
  const terms = queryTerms(topic);
  const skus = terms.filter(term => SKU.test(term));
  const others = terms.filter(term => !SKU.test(term));
  // A short question ("几天能发货") shares one real word with the entry's question or title: accept it when enough of its
  // characters also appear there. Long questions keep the stricter coverage rule.
  const short = others.length <= 6;
  const characters = contentCharacters(topic);
  const hits: KnowledgeHit[] = [];
  for (const item of scoped) {
    if (!knowledgeAvailable(item) || (allowed && !allowed.has(item.id))
      || (input.scenario && input.scenario !== 'all' && item.scenario && item.scenario !== 'all' && item.scenario !== input.scenario)) continue;
    const fields: Array<[string, string, number]> = [['问题', item.question ?? '', 7], ['相似问法', (item.aliases ?? []).join('\n'), 8], ['标题', item.title, 5], ['标签', item.tags.join(' '), 4], ['正文', item.content, 1]];
    let score = 0; const matched = new Set<string>(); const matchedFields: string[] = [];
    let headline = false;
    for (const [name, raw, weight] of fields) {
      const field = normalizeKnowledgeQuery(raw); if (!field) continue;
      const found = terms.filter(term => containsTerm(field, term));
      const exact = query.length >= 2 && (field === query || (name === '相似问法' && (item.aliases ?? []).some(alias => normalizeKnowledgeQuery(alias) === query)));
      if (found.length || exact) { matchedFields.push(name); found.forEach(term => matched.add(term)); score += weight * found.length / Math.sqrt(Math.max(1, field.length / 100)) + (exact ? 40 : 0); }
      if (['问题', '相似问法', '标题'].includes(name) && found.some(term => !SKU.test(term) && term.length >= 2)) headline = true;
    }
    if (!score) continue;
    const text = normalizeKnowledgeQuery(`${item.title}\n${item.question ?? ''}\n${(item.aliases ?? []).join('\n')}\n${item.content}`);
    // Asked about A025: an entry about another model must not answer, whatever else it shares with the question.
    const itemSkus = skuTerms(text);
    if (skus.length && !skus.some(sku => matched.has(sku)) && itemSkus.length) continue;
    // The model code is strong evidence: it counts twice for a short question.
    const skuBonus = skus.some(sku => matched.has(sku)) && others.length <= 2 ? 1 : 0;
    const strength = matched.size + skuBonus;
    const covered = strength >= Math.ceil(terms.length * 0.35)
      && (matchedFields.includes('问题') || matchedFields.includes('相似问法') || strength >= Math.min(2, terms.length));
    let overlap = 0;
    if (!covered && short && headline) {
      const head = contentCharacters(normalizeKnowledgeQuery(`${item.title}\n${item.question ?? ''}\n${(item.aliases ?? []).join('\n')}`));
      for (const c of characters) if (head.has(c)) overlap++;
    }
    // A shared product name alone must not answer a question about an unknown policy.
    if (!covered && overlap < 2) continue;
    hits.push({ id: item.id, title: item.title, content: item.content, question: item.question, source: item.source, sourceLocator: item.sourceLocator,
      score: Math.round(score * 100) / 100, matchedTerms: [...matched].map(term => term.replace(/^@/, '')), matchedFields });
  }
  hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return { query: input.query.trim(), hits: hits.slice(0, limit), status: hits.length ? 'matched' : 'no_match', note: '本地关键词检索，不调用模型；分数仅用于排序，不代表回答正确率。无匹配时应澄清或转人工。' };
}

const REPLACED_TAG = '资料版本:已替换';
const UNVERIFIED_TAG = '资料状态:待核对';
// Pasted text has a generic name; only a named file can be recognized as "the same document again".
const manualImport = (item: Knowledge) => !!item.importId?.startsWith('import_') && !!item.source && !/^粘贴/.test(item.source);
function previousImportIds(knowledge: Knowledge[], source: string | undefined, importId?: string) {
  if (!source || /^粘贴/.test(source)) return [];
  return [...new Set(knowledge.filter(k => manualImport(k) && k.source === source && k.importId !== importId && !k.tags.includes(REPLACED_TAG)).map(k => k.importId!))].slice(0, 20);
}
function previousImports(knowledge: Knowledge[], sources: Array<string | undefined>): KnowledgeImportReplaces[] {
  return [...new Set(sources.filter((s): s is string => !!s))].flatMap(source => {
    const ids = previousImportIds(knowledge, source);
    const count = knowledge.filter(k => k.importId && ids.includes(k.importId) && !k.tags.includes(REPLACED_TAG) && (knowledgeAvailable(k) || k.reviewStatus === 'pending')).length;
    return count ? [{ source, count }] : [];
  });
}

/**
 * Approves what can be approved. Strict callers (partial=false) get the first problem as an error and nothing changes;
 * the knowledge page asks for a partial review and shows every entry that stayed pending with its reason.
 * `retireIds` are older entries the owner chose to turn off in favour of the new ones (「停用旧条目并启用新条目」).
 */
export function reviewKnowledge(knowledge: Knowledge[], ids: string[], retireIds: string[], partial: boolean): KnowledgeReviewResult {
  const conflicts: KnowledgeReviewResult['conflicts'] = []; const retired: string[] = [];
  const fail = (status: number, message: string): never => { throw new ApiError(status, message); };
  const selected = ids.map(id => knowledge.find(item => item.id === id));
  const reject = (item: Knowledge | undefined, id: string, reason: string, conflictIds: string[] = [], status = 409) => {
    if (!partial) fail(status, reason);
    conflicts.push({ id, title: item?.title ?? '', reason, conflictIds });
  };
  if (!partial) {
    if (selected.some(item => item?.tags.includes(REPLACED_TAG))) fail(409, '旧版本已被资料源替换，请审核新版本。');
    if (selected.some(item => item?.tags.includes(UNVERIFIED_TAG))) fail(409, '资料源读取未完成，请重新整理后核对启用。');
    if (selected.some(item => !item)) fail(409, '知识条目已变化，请刷新后重试');
  }
  const retire = retireIds.map(id => knowledge.find(item => item.id === id));
  if (retire.some(item => !item) || retireIds.some(id => ids.includes(id))) fail(409, '要停用的旧条目已变化，请刷新后重试');
  // Entries the approved imports replace stop answering together with the approval; they are no conflict.
  const superseded = new Set(selected.flatMap(item => item?.supersedes ?? []));
  const replacedByImport = (other: Knowledge) => !!other.importId && superseded.has(other.importId) && manualImport(other);
  const live = (other: Knowledge) => knowledgeAvailable(other) && !retireIds.includes(other.id) && !replacedByImport(other);
  const approvable: Knowledge[] = [];
  selected.forEach((item, index) => {
    const id = ids[index];
    if (!item) return reject(item, id, '这条知识已经删除或变化，请刷新后重试。');
    if (item.tags.includes(REPLACED_TAG)) return reject(item, id, '这是被新资料替换的旧版本，请审核新版本。');
    if (item.tags.includes(UNVERIFIED_TAG)) return reject(item, id, '资料源读取未完成，请重新整理后核对启用。');
    const placeholder = unfilledPlaceholder(item);
    if (placeholder) return reject(item, id, /^【(?:未配对|客户原话|我方原话)/.test(placeholder) ? `“${item.title}”是聊天原话，还没整理成问答：请改写成客户的问题和你的回答，删掉【】标记后再启用。` : `“${item.title}”里还有${placeholder}没填：请把【】换成你自己的信息，或删掉这段，再启用。`, [], 400);
    const existing = knowledge.filter(other => live(other) && contradicts(item, other));
    if (existing.length) return reject(item, id, partial ? `“${item.title}”和已在用的“${existing[0].title}”是同一个问题、答案不同：可以停用旧条目并启用这条，或先改成不同的问题。` : `“${item.title}”存在同问题不同答案，请先区分适用场景或停用旧条目`, existing.map(other => other.id));
    const sibling = selected.filter((other): other is Knowledge => !!other && contradicts(item, other));
    if (sibling.length) return reject(item, id, partial ? `“${item.title}”和这次一起选的“${sibling[0].title}”是同一个问题、答案不同：请只保留一条。` : `“${item.title}”存在同问题不同答案，请先区分适用场景或停用旧条目`, sibling.map(other => other.id));
    approvable.push(item);
  });
  const timestamp = new Date().toISOString();
  for (const item of retire as Knowledge[]) if (item.enabled) { item.enabled = false; item.updatedAt = timestamp; retired.push(item.id); }
  for (const item of approvable) { item.reviewStatus = 'approved'; item.enabled = true; item.approvedAt = timestamp; item.updatedAt = timestamp; delete item.heldForReview; }
  const approvedImports = new Set(approvable.flatMap(item => item.supersedes ?? []));
  for (const old of knowledge) if (old.importId && approvedImports.has(old.importId) && manualImport(old) && !old.tags.includes(REPLACED_TAG) && !approvable.includes(old)) {
    old.enabled = false; old.tags = [...new Set([...old.tags, REPLACED_TAG])].slice(0, 20); old.updatedAt = timestamp; retired.push(old.id);
  }
  return { approved: approvable.map(item => item.id), conflicts, retired };
}

/**
 * 自主进化: knowledge 咔哒 organized from the owner's own material (imported files, folder and drive sources, knowledge
 * packs, chat extracts) may answer customers without a per-entry confirmation when the owner keeps the preference on.
 * Never eligible: industry samples and demo templates, entries the owner edited and saved for review, old versions,
 * and anything the owner typed in the editor (the editor has its own 「保存并启用」).
 */
export function autoEnableEligible(item: Knowledge) {
  if (item.reviewStatus !== 'pending' || item.enabled || item.heldForReview || item.tags.includes(REPLACED_TAG) || item.id.startsWith('knowledge_demo_')) return false;
  if (item.tags.includes('行业样板') || /^(行业样板|示例模板)/.test(item.source ?? '')) return false;
  return !!item.importId || item.source === '知识包导入' || item.source === '本地聊天记录';
}
export const AUTO_ENABLE_INTERNAL_REASON = (title: string) => `“${title}”是内部资料，不发给客户，所以没有自动启用。`;
/**
 * Approves eligible pending entries through the same partial review the owner uses, so everything that review refuses
 * (同问题不同答案, 【】 not filled, 资料源没读完整) stays pending with its reason. 内部资料 is never approved automatically.
 * `ids` limits the pass to entries just created; without it every eligible pending entry is considered.
 */
export function autoEnableKnowledge(knowledge: Knowledge[], ids?: string[]): KnowledgeReviewResult {
  const pool = ids ? [...new Set(ids)].map(id => knowledge.find(item => item.id === id)).filter((item): item is Knowledge => !!item) : knowledge;
  const result: KnowledgeReviewResult = { approved: [], conflicts: [], retired: [] };
  const candidates: string[] = [];
  for (const item of pool) {
    if (!autoEnableEligible(item)) continue;
    if (categorize(`${item.title} ${item.question ?? ''}`, item.tags) === '内部资料') { result.conflicts.push({ id: item.id, title: item.title, reason: AUTO_ENABLE_INTERNAL_REASON(item.title), conflictIds: [] }); continue; }
    candidates.push(item.id);
  }
  for (let i = 0; i < candidates.length; i += KNOWLEDGE_IMPORT_LIMITS.rows) {
    const reviewed = reviewKnowledge(knowledge, candidates.slice(i, i + KNOWLEDGE_IMPORT_LIMITS.rows), [], true);
    result.approved.push(...reviewed.approved); result.conflicts.push(...reviewed.conflicts); result.retired.push(...reviewed.retired);
  }
  return result;
}

export function createKnowledgeWorkbench(options: {
  getState(): AppState;
  mutate(action: string, taskId: string | undefined, detail: string, change: () => void): Promise<void>;
  parse(input: unknown): Promise<{ rows: KnowledgeDraft[]; warnings: string[] }>;
  organize?(sources: OrganizeSource[]): Promise<OrganizedKnowledge>;
  /** 自主进化: runs after a commit with the ids it created; undefined when the owner turned it off. */
  autoEnable?(ids: string[]): Promise<KnowledgeReviewResult | undefined>;
}) {
  type CommitResult = { created: Knowledge[]; skipped: number; importId: string; retiredOnApproval: number; autoEnabled?: KnowledgeReviewResult };
  // One preview may be committed in several batches of up to 300 rows; every batch shares the preview's import id.
  const previews = new Map<string, { value: KnowledgeImportPreview; importId: string; commits: Map<string, { result?: CommitResult; commit?: Promise<CommitResult> }>; committed: Set<string> }>();
  let parsing = false;
  function cleanup() { for (const [key, entry] of previews) if (Date.parse(entry.value.expiresAt) <= Date.now()) previews.delete(key); }
  function remember(value: KnowledgeImportPreview) { if (previews.size >= 4) previews.delete(previews.keys().next().value!); previews.set(value.previewId, { value, importId: `import_${randomUUID()}`, commits: new Map(), committed: new Set() }); }
  return {
    async handle(method: string, path: string, body: Record<string, unknown>): Promise<unknown> {
      const state = options.getState();
      if (method === 'POST' && path === '/knowledge/import/organize') {
        cleanup();
        if (body.allowModel !== true) throw new ApiError(400, '请确认将所选资料发送到已配置的回复模型。');
        const entry = typeof body.previewId === 'string' ? previews.get(body.previewId) : undefined;
        if (!entry || entry.committed.size) throw new ApiError(409, '预览已失效或已提交，请重新预览。');
        if (!strings(body.rowIds, 20, 100) || !body.rowIds.length || new Set(body.rowIds).size !== body.rowIds.length) throw new ApiError(400, '每次智能整理请选择1–20条资料。');
        const sources = body.rowIds.map(id => entry.value.rows.find(r => r.rowId === id));
        if (sources.some(r => !r || r.errors.length)) throw new ApiError(400, '所选资料无效，请先修正预览。');
        if (parsing) throw new ApiError(409, '已有资料正在处理，请稍后再试');
        if (!options.organize) throw new ApiError(503, '当前环境没有可用的资料整理模型。');
        parsing = true;
        try {
          const result = await options.organize(sources as OrganizeSource[]);
          if (entry.committed.size) throw new ApiError(409, '原预览已提交，整理结果未覆盖原文。');
          const values = entry.value.rows.map(r => result.rows.find(n => n.rowId === r.rowId) ?? r);
          const fingerprints = new Map(options.getState().knowledge.map(k => [knowledgeFingerprint(k), k.id]));
          const rows = values.map(r => {
            const valid = readKnowledgeDraft(r), fingerprint = knowledgeFingerprint(valid), duplicateOf = fingerprints.get(fingerprint);
            if (!duplicateOf) fingerprints.set(fingerprint, `本批第 ${r.rowId} 条`);
            return { ...valid, rowId: r.rowId, errors: [], ...(duplicateOf ? { duplicateOf } : {}) };
          });
          const value: KnowledgeImportPreview = { previewId: randomUUID(), expiresAt: new Date(Date.now() + 30 * 60000).toISOString(), rows, organization: result.organization,
            warnings: [...new Set([...entry.value.warnings, '智能整理仅分析本次所选资料并补充检索字段；事实正文保持原文。业务和语气是待核对的建议，未自动启用。'])], ...(entry.value.replaces ? { replaces: entry.value.replaces } : {}) };
          remember(value); return structuredClone(value);
        } finally { parsing = false; }
      }
      if (method === 'POST' && path === '/knowledge/search') return retrieveKnowledge(state.knowledge, body as unknown as KnowledgeSearchInput);
      if (method === 'POST' && path === '/knowledge/evaluate') {
        if (!Array.isArray(body.cases) || !body.cases.length || body.cases.length > 100) throw new ApiError(400, '每次演练需要 1–100 个问题');
        const results = body.cases.map(row => {
          if (!object(row) || !text(row.question, 4000, true) || (row.expectedTitle !== undefined && !text(row.expectedTitle, 200))) throw new ApiError(400, '测试问题或预期标题无效');
          const result = retrieveKnowledge(state.knowledge, { query: row.question, scenario: body.scenario as Scenario | 'all' | undefined });
          const expectedTitle = (row.expectedTitle as string | undefined)?.trim();
          return { ...result, expectedTitle, passed: expectedTitle ? result.hits[0]?.title === expectedTitle : !result.hits.length };
        });
        return { total: results.length, matched: results.filter(r => r.hits.length).length, passed: results.filter(r => r.passed).length, results } satisfies KnowledgeEvaluationResult;
      }
      if (method === 'POST' && path === '/knowledge/import/preview') {
        if (parsing) throw new ApiError(409, '已有资料正在解析，请稍后再试');
        parsing = true;
        try {
          const parsed = await options.parse(body); cleanup();
          if (!parsed.rows.length) throw new ApiError(400, '未找到知识条目，请检查资料内容');
          if (parsed.rows.length > KNOWLEDGE_IMPORT_LIMITS.previewRows) throw new ApiError(400, `超出单次 ${KNOWLEDGE_IMPORT_LIMITS.previewRows} 条，请把资料拆成几份分别导入`);
          const fingerprints = new Map(options.getState().knowledge.map(item => [knowledgeFingerprint(item), item.id]));
          const rows = parsed.rows.map((row, index) => {
            const rowId = String(index + 1); const errors: string[] = [];
            try { readKnowledgeDraft(row); } catch (error) { errors.push((error as Error).message); }
            const fingerprint = knowledgeFingerprint(row); const duplicateOf = fingerprints.get(fingerprint);
            if (!duplicateOf) fingerprints.set(fingerprint, `本批第 ${rowId} 条`);
            return { ...row, rowId, errors, ...(duplicateOf ? { duplicateOf } : {}) };
          });
          const replaces = previousImports(options.getState().knowledge, rows.map(row => row.source));
          const warnings = [...parsed.warnings];
          if (replaces.length) warnings.unshift(`这份资料之前导入过，新内容审核后旧版本会停用（${replaces.map(r => `「${r.source}」${r.count} 条`).join('、')}）。没变的内容会自动跳过，继续使用。`);
          if (rows.length > KNOWLEDGE_IMPORT_LIMITS.rows) warnings.unshift(`共 ${rows.length} 条，会分几批保存（每批最多 ${KNOWLEDGE_IMPORT_LIMITS.rows} 条），一条都不会漏。`);
          const value: KnowledgeImportPreview = { previewId: randomUUID(), expiresAt: new Date(Date.now() + 30 * 60000).toISOString(), rows, warnings, ...(replaces.length ? { replaces } : {}) };
          remember(value); return structuredClone(value);
        } finally { parsing = false; }
      }
      if (method === 'POST' && path === '/knowledge/import/commit') {
        cleanup();
        if (body.confirm !== true || typeof body.previewId !== 'string' || !Array.isArray(body.rows) || !body.rows.length || body.rows.length > KNOWLEDGE_IMPORT_LIMITS.rows
          || (body.replacePrevious !== undefined && typeof body.replacePrevious !== 'boolean')) throw new ApiError(400, `请预览并确认要导入的知识条目（每批最多 ${KNOWLEDGE_IMPORT_LIMITS.rows} 条）`);
        const entry = previews.get(body.previewId); if (!entry) throw new ApiError(409, '导入预览已失效，请重新预览');
        const signature = JSON.stringify([body.rows, body.replacePrevious === true]);
        const known = entry.commits.get(signature);
        if (known?.result) return structuredClone(known.result);
        if (known?.commit) return known.commit;
        const rowIds = new Set<string>();
        const drafts = body.rows.map(raw => {
          if (!object(raw) || typeof raw.rowId !== 'string' || rowIds.has(raw.rowId) || Object.keys(raw).some(key => !['rowId', 'title', 'content', 'tags', 'question', 'aliases', 'scenario'].includes(key))) throw new ApiError(400, '导入行或字段无效');
          rowIds.add(raw.rowId); const original = entry.value.rows.find(row => row.rowId === raw.rowId);
          if (!original) throw new ApiError(400, '导入行不属于此预览');
          return { ...readKnowledgeDraft(raw), source: original.source, sourceLocator: original.sourceLocator };
        });
        if ([...rowIds].some(id => entry.committed.has(id))) throw new ApiError(409, '此预览已经提交，请在知识库中编辑');
        const replacePrevious = body.replacePrevious === true;
        for (const id of rowIds) entry.committed.add(id);
        const run = (async (): Promise<CommitResult> => {
          const created: Knowledge[] = []; let skipped = 0, retiredOnApproval = 0; const importId = entry.importId;
          await options.mutate('knowledge_imported', undefined, `导入 ${drafts.length} 条已预览资料，默认停用并等待审核`, () => {
            const current = options.getState();
            const known = new Set(current.knowledge.map(knowledgeFingerprint)); const timestamp = new Date().toISOString();
            const additions = new Set(drafts.map(knowledgeFingerprint).filter(fingerprint => !known.has(fingerprint)));
            if (current.knowledge.length + additions.size > 10000) throw new ApiError(400, '知识库最多保留 10,000 条，请先整理已有资料');
            for (const draft of drafts) {
              // The earlier manual imports of this same file: retired once this new version is approved.
              const supersedes = replacePrevious ? previousImportIds(current.knowledge, draft.source, importId) : [];
              const fingerprint = knowledgeFingerprint(draft);
              if (known.has(fingerprint)) {
                // An unchanged fact of the old version becomes part of the new one and keeps answering, approval intact.
                for (const same of current.knowledge) if (same.importId && supersedes.includes(same.importId) && manualImport(same) && !same.tags.includes(REPLACED_TAG) && knowledgeFingerprint(same) === fingerprint) {
                  same.importId = importId; same.sourceLocator = draft.sourceLocator; same.updatedAt = timestamp;
                }
                skipped++; continue;
              }
              known.add(fingerprint);
              retiredOnApproval = Math.max(retiredOnApproval, current.knowledge.filter(k => k.importId && supersedes.includes(k.importId) && !k.tags.includes(REPLACED_TAG)).length);
              const item: Knowledge = { ...draft, id: `knowledge_${randomUUID()}`, enabled: false, reviewStatus: 'pending', importId, createdAt: timestamp, updatedAt: timestamp, ...(supersedes.length ? { supersedes } : {}) };
              current.knowledge.push(item); created.push(item);
            }
            // Nothing new to approve (the new file only dropped lines): the old version's leftovers retire right away.
            if (replacePrevious && !created.length && !current.knowledge.some(k => k.importId === importId && k.reviewStatus === 'pending')) {
              const old = new Set(drafts.flatMap(draft => previousImportIds(current.knowledge, draft.source, importId)));
              for (const item of current.knowledge) if (item.importId && old.has(item.importId) && manualImport(item) && !item.tags.includes(REPLACED_TAG)) {
                item.enabled = false; item.tags = [...new Set([...item.tags, REPLACED_TAG])].slice(0, 20); item.updatedAt = timestamp; retiredOnApproval++;
              }
            }
          });
          // A failed automatic approval never undoes the import: the entries simply wait for the owner.
          const autoEnabled = created.length && options.autoEnable ? await options.autoEnable(created.map(item => item.id)).catch(() => undefined) : undefined;
          const current = (item: Knowledge) => options.getState().knowledge.find(k => k.id === item.id) ?? item;
          const result: CommitResult = { created: structuredClone(created.map(current)), skipped, importId, retiredOnApproval, ...(autoEnabled ? { autoEnabled } : {}) };
          entry.commits.set(signature, { result }); return structuredClone(result);
        })();
        entry.commits.set(signature, { commit: run });
        try { return await run; } catch (error) { entry.commits.delete(signature); for (const id of rowIds) entry.committed.delete(id); throw error; }
      }
      if (method === 'POST' && path === '/knowledge/review') {
        if (body.approved !== true || !strings(body.ids, 300, 200) || !body.ids.length || new Set(body.ids).size !== body.ids.length
          || (body.retireIds !== undefined && !strings(body.retireIds, 300, 200)) || (body.partial !== undefined && typeof body.partial !== 'boolean')) throw new ApiError(400, '请明确审核 1–300 条知识');
        const ids = body.ids, retireIds = (body.retireIds as string[] | undefined) ?? [], partial = body.partial === true;
        let outcome!: KnowledgeReviewResult;
        await options.mutate('knowledge_reviewed', undefined, `人工审核并启用 ${ids.length} 条知识${retireIds.length ? `，停用 ${retireIds.length} 条旧条目` : ''}`, () => {
          outcome = reviewKnowledge(options.getState().knowledge, ids, retireIds, partial);
        });
        return { ...structuredClone(options.getState()), review: outcome };
      }
      return undefined;
    },
  };
}
