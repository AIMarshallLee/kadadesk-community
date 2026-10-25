import { customerMarket, type CustomerMarket } from '../shared/customer-market';
import { createHash, randomUUID } from 'node:crypto';
import type { AppState } from '../shared/types';
import type { TrainingRecord, TrainingView } from '../shared/knowledge-training';
import { ApiError } from './api-error';
import { knowledgeAvailable } from './knowledge';
import { conversationHistory, readConversationIntent, type ConversationTurn, type ConversationIntent } from '../shared/conversation-intent';

export function validateTraining(value: unknown): TrainingRecord[] {
  if (value === undefined) return [];
  const text = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
  if (!Array.isArray(value) || value.length > 50 || new Set(value.map(v => v?.id)).size !== value.length
    || value.some(r => !r || !text(r.id, 200) || !r.id || !text(r.question, 4000) || !r.question.trim()
      || !text(r.answer, 20000) || !r.answer.trim() || !text(r.model, 200) || !text(r.workflowId, 200)
      || !/^[a-f0-9]{64}$/.test(r.revision) || !Number.isFinite(Date.parse(r.createdAt))
      || !['pending', 'correct', 'incorrect'].includes(r.verdict) || !Array.isArray(r.knowledgeIds)
      || r.knowledgeIds.length > 500 || r.knowledgeIds.some((id: unknown) => !text(id, 200)))) throw new ApiError(400, '试答记录无效');
  return value.map(r => ({ id:r.id, question:r.question, answer:r.answer, model:r.model, workflowId:r.workflowId, customerMarket:customerMarket(r.customerMarket),
    knowledgeIds:[...r.knowledgeIds], revision:r.revision, createdAt:r.createdAt, verdict:r.verdict,history:conversationHistory(r.history),intent:readConversationIntent(r.intent) }));
}

export function trainingRevision(state: AppState): string {
  // Loading a backup can reorder object keys without changing any business fact.
  const stable = (value: any): any => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,stable(value[k])])) : value;
  return createHash('sha256').update(JSON.stringify(stable({ knowledge:state.knowledge, workflows:state.workflows,
    provider:state.provider, policy:'conversation-routing-v1' }))).digest('hex');
}

export function createKnowledgeTraining(options: {
  state(): AppState;
  mutate(action: string, taskId: undefined, detail: string, fn: () => void): Promise<void>;
  answer(question: string, workflowId: string, market: CustomerMarket, history?:ConversationTurn[]): Promise<{ baseReply: string; model: string; knowledgeSources: Array<{ id: string }>; intent?:ConversationIntent }>;
}) {
  let busy = false;
  function view(): TrainingView {
    const state = options.state(), revision = trainingRevision(state);
    const records = (state.training ?? []).map(r => ({ ...r, current:r.revision === revision }));
    const approved = state.knowledge.filter(knowledgeAvailable).filter(k=>!k.id.startsWith('knowledge_demo_'));
    const suggestions = [...new Set(approved.flatMap(k => [k.aliases?.[0], k.question || k.title]).filter((s): s is string => !!s))].slice(0, 50);
    const judged = records.filter(r => r.current && r.verdict !== 'pending');
    return {records, suggestions, approvedKnowledge:approved.length, pendingKnowledge:state.knowledge.filter(k=>k.reviewStatus==='pending').length,
      checked:judged.length, correct:judged.filter(r=>r.verdict==='correct').length, incorrect:judged.filter(r=>r.verdict==='incorrect').length};
  }
  return {
    async handle(method: string, path: string, body: Record<string, unknown>): Promise<unknown> {
      if (method === 'GET' && path === '/knowledge/training') return view();
      if (method === 'POST' && path === '/knowledge/training/answer') {
        if (body.allowModel !== true) throw new ApiError(400, '请确认使用回复模型试答，会产生模型费用；不会向客户发送。');
        if (typeof body.question !== 'string' || !body.question.trim() || body.question.length > 4000
          || (body.workflowId !== undefined && (typeof body.workflowId !== 'string' || body.workflowId.length > 200))) throw new ApiError(400, '请输入1–4000字的问题，并选择回复风格。');
        if (busy) throw new ApiError(409, '上一题仍在试答，请等待完成。');
        if (!view().approvedKnowledge) throw new ApiError(400, '请先导入并确认至少一条自己的业务资料。');
        busy = true;
        try {
          const revision = trainingRevision(options.state());
          const question = body.question.trim(), workflowId = (body.workflowId as string) || '';
          // Same default as live replies on a Chinese chat: domestic (RMB), unless the caller chose a market.
          const market = body.customerMarket === undefined ? 'domestic' : customerMarket(body.customerMarket);
          const history=conversationHistory(body.history);
          const result = await options.answer(question, workflowId, market, history);
          if (trainingRevision(options.state()) !== revision) throw new ApiError(409, '试答期间资料、回复规则或模型已变化，请重新试答。');
          const record: TrainingRecord = { id:randomUUID(), question, answer:result.baseReply, model:result.model, workflowId, customerMarket:market,
            knowledgeIds:result.knowledgeSources.map(k=>k.id), history, intent:result.intent, revision, createdAt:new Date().toISOString(), verdict:'pending' };
          validateTraining([record]);
          await options.mutate('knowledge_trial', undefined, '保存真实模型试答；未发送外部消息', () => {
            if (trainingRevision(options.state()) !== revision) throw new ApiError(409, '资料已变化，请重新试答');
            options.state().training = [record, ...(options.state().training ?? [])].slice(0, 50);
          });
          return view();
        } finally { busy = false; }
      }
      if (method === 'POST' && path === '/knowledge/training/review') {
        if (typeof body.id !== 'string' || !['correct', 'incorrect'].includes(body.verdict as string)) throw new ApiError(400, '请标记答对或需要修改。');
        await options.mutate('knowledge_trial_review', undefined, '人工核对试答结果', () => {
          const record = options.state().training?.find(r => r.id === body.id);
          if (!record) throw new ApiError(404, '试答记录不存在');
          if (record.revision !== trainingRevision(options.state())) throw new ApiError(409, '资料或模型已变更，旧试答不能标记通过，请重试。');
          record.verdict = body.verdict as 'correct' | 'incorrect';
        });
        return view();
      }
    },
  };
}
