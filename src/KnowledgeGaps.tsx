import { useState } from 'react';
import { Button } from './components';
import { api, navigate } from './api';
import type { DesktopReplyJob, ChatObservation } from '../shared/desktop-replies';

/** 待补充知识：customer questions the desk could not answer with confidence (handoff / uncertain / no knowledge hit).
 *  Writing an answer here files a knowledge entry for review, so the next same question is answered from it. */
export default function KnowledgeGaps({ jobs, checkpoints, notify }: { jobs: DesktopReplyJob[]; checkpoints?: Record<string, ChatObservation>; notify: (message: string, error?: boolean) => void }) {
  // What the human actually answered after the handoff, read from the last screen observation of that chat: one click files it.
  const humanReply = (job: DesktopReplyJob) => { const obs = checkpoints?.[job.conversationId]; if (!obs) return ''; const idx = obs.messages.findIndex(m => m.direction === 'incoming' && m.text.trim() === job.input.trim()); const after = idx >= 0 ? obs.messages.slice(idx + 1) : []; return after.filter(m => m.direction === 'outgoing' && m.text.trim() && m.text.trim() !== job.reply.trim()).map(m => m.text.trim()).join('\n'); };
  const [open, setOpen] = useState<string | undefined>();
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Set<string>>(new Set());
  const week = Date.now() - 7 * 24 * 3600000;
  const gaps = jobs.filter(j => j.source !== 'media' && j.source !== 'remote' && j.source !== 'rule' && j.input && Date.parse(j.createdAt) > week && !done.has(j.id) && (['handoff', 'uncertain', 'failed'].includes(j.status) || (j.knowledgeIds?.length ?? 0) === 0))
    .filter((j, i, all) => all.findIndex(o => o.input.trim() === j.input.trim()) === i).slice(0, 20);
  if (!gaps.length) return null;
  const file = async (job: DesktopReplyJob) => {
    const content = answer.trim(); if (!content) return;
    setBusy(true);
    try {
      await api('POST', '/knowledge', { title: job.input.trim().slice(0, 40), question: job.input.trim().slice(0, 2000), content, tags: ['客服问答', '来源:接待'], scenario: 'all', source: '接待待补充' });
      setDone(prev => new Set(prev).add(job.id)); setOpen(undefined); setAnswer('');
      notify('已加入待审核知识；在「知识」里审核启用后生效。');
    } catch (error) { notify((error as Error).message, true); } finally { setBusy(false); }
  };
  const answered = gaps.filter(job => humanReply(job));
  const fileAll = async () => {
    setBusy(true); let count = 0;
    try {
      for (const job of answered) { await api('POST', '/knowledge', { title: job.input.trim().slice(0, 40), question: job.input.trim().slice(0, 2000), content: humanReply(job), tags: ['客服问答', '来源:人工回复'], scenario: 'all', source: '接待待补充' }); setDone(prev => new Set(prev).add(job.id)); count++; }
      notify(`已把 ${count} 条人工回复存为待审核知识；在「知识」里审核启用后生效。`);
    } catch (error) { notify((error as Error).message, true); } finally { setBusy(false); }
  };
  return <details className="dr-takeovers" open><summary>待补充知识 · {gaps.length} 个客户问题没有依据或转了人工</summary>
    <p className="muted" style={{ margin: '4px 0 8px' }}>写下正确答案，下次同类问题就由知识库回答。{answered.length > 0 && <> 其中 {answered.length} 条你已在聊天里回过：<Button variant="secondary" busy={busy} onClick={() => void fileAll()}>一键存为知识</Button></>}</p>
    {gaps.map(job => <div key={job.id} style={{ borderTop: '1px solid #f0f2f5', padding: '8px 0' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}><strong style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{job.conversationName}</strong><span style={{ fontSize: 12, color: '#556273', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.input}</span><Button variant="secondary" onClick={() => { setOpen(open === job.id ? undefined : job.id); setAnswer(humanReply(job)); }}>{open === job.id ? '收起' : '写答案'}</Button></div>
      {open === job.id && <div style={{ marginTop: 6 }}><textarea aria-label="知识答案" rows={3} style={{ width: '100%', boxSizing: 'border-box' }} placeholder="对客户说的答案（会进入待审核）；你在聊天里已回复过的话会自动填进来" value={answer} onChange={e => setAnswer(e.target.value)} /><div style={{ display: 'flex', gap: 8, marginTop: 6 }}><Button busy={busy} disabled={!answer.trim()} onClick={() => void file(job)}>存为待审核知识</Button><Button variant="ghost" onClick={() => navigate('knowledge')}>去知识页</Button></div></div>}
    </div>)}
  </details>;
}
