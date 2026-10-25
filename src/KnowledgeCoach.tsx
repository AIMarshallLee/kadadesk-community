import CustomerMarketField from './CustomerMarketField';
import { intentLabel, type ConversationTurn } from '../shared/conversation-intent';
import { marketLabel, type CustomerMarket } from '../shared/customer-market';
import { useEffect, useRef, useState } from 'react';
import { Check, FileUp, MessageSquare, Sparkles } from 'lucide-react';
import type { PageProps } from './App';
import type { TrainingView } from '../shared/knowledge-training';
import { api, navigate } from './api';
import { Button, Field } from './components';

export default function KnowledgeCoach({ state, perform, busy, notify, onImport, onReview, onFix }: PageProps & {
  onImport(): void; onReview(): void; onFix(question: string, id?: string): void;
}) {
  const [view, setView] = useState<TrainingView>();
  // Practice like live replies: the reception's configured market, else domestic (a Chinese chat is quoted in RMB).
  const [market, setMarket] = useState<CustomerMarket>('domestic');
  const marketTouched = useRef(false);
  useEffect(() => { let active = true; void window.flowdesk?.desktopReplies?.state().then(v => { const configured = (v as { config?: { customerMarket?: CustomerMarket } })?.config?.customerMarket; if (active && !marketTouched.current && (configured === 'domestic' || configured === 'international')) setMarket(configured); }).catch(() => {}); return () => { active = false; }; }, []);
  const [question, setQuestion] = useState('');
  const [historyText, setHistoryText] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [consent, setConsent] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const cancel = useRef(false), mounted = useRef(true);
  const revision = JSON.stringify([state.knowledge, state.workflows, state.provider, state.training]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cancel.current = true; }; }, []);
  useEffect(() => { let active = true; void api<TrainingView>('GET', '/knowledge/training').then(v => { if(active){setView(v);setError('');} }).catch(e=>{if(active)setError(e.message);}); return()=>{active=false;}; }, [revision]);
  const modelReady = Boolean(state.provider.hasKey);
  const ready = !!view?.approvedKnowledge && modelReady;
  const blocker = !view?.approvedKnowledge ? '还没有确认过的资料：先在上面导入并确认，再来试答。' : !modelReady ? '还没接好回复模型，先到「设置」一键配置。' : !consent ? '先勾选上面的「同意试答」，按钮才能点。' : '';
  async function answer(questions: string[]) {
    if (running || busy) return;
    setRunning(true); cancel.current = false; setError('');
    try {
      const history: ConversationTurn[] = historyText.split('\n').filter(line=>line.trim()).map(line=>{
        const match=line.match(/^(客户|我方)[:：]\s*(.+)$/);
        if(!match)throw Error('上文每行请以“客户：”或“我方：”开头。');
        return {direction:match[1]==='客户'?'incoming':'outgoing',text:match[2]};
      });
      if(history.length>12)throw Error('请保留最近 12 条对话。');
      for (let i=0;i<questions.length;i++) {
        if(cancel.current)break;
        setProgress(`正在试答 ${i+1}/${questions.length}：${questions[i]}`);
        const result = await api<TrainingView>('POST', '/knowledge/training/answer', { question:questions[i], history, workflowId, customerMarket:market, allowModel:consent });
        if(mounted.current)setView(result);
      }
      if(mounted.current) {setProgress(cancel.current ? '已停止后续试答，已完成结果保留。' : '试答完成。请对照资料核对下面的回答。'); await perform('GET','/state');}
    } catch(e) { if(mounted.current)setError((e as Error).message); }
    finally { if(mounted.current)setRunning(false); }
  }
  async function review(id:string, verdict:'correct'|'incorrect') {
    const result = await perform<TrainingView>('POST','/knowledge/training/review',{id,verdict});
    if(result)setView(result);
  }
  const availableWorkflows = state.workflows.filter(w=>w.enabled&&!w.id.startsWith('workflow_demo_'));
  const suggested = view?.suggestions.slice(0,5) ?? [];
  return <div className="knowledge-coach">
    <section className="panel coach-welcome" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
      <div style={{ fontSize: 13 }}>{view?.pendingKnowledge ? <><strong>{view.pendingKnowledge} 条资料等你看一眼</strong>，确认后咔哒才会用它回答客户。</> : <><strong>{view?.approvedKnowledge ?? 0} 条资料在用。</strong>下面问一个客户常问的问题，看咔哒答得对不对。</>}</div>
      <div className="page-actions">{!!view?.pendingKnowledge && <Button disabled={running} onClick={onReview}>去确认</Button>}<Button variant="secondary" disabled={running} onClick={()=>navigate('knowledge/sources')}>资料已在文件夹？直接读取</Button></div>
    </section>
    <section className="panel coach-practice" id="coach-practice"><div className="panel-head"><div><h2><MessageSquare size={18}/>客户会怎么问？让助手答一次</h2><p>不是修改大模型本身，而是检查它能否依据你的资料回答。修改资料后需要重新试答。</p></div></div>
      <div className="coach-body">
        {!modelReady&&<div className="notice warning">还没配置回复模型。请先到设置配置模型后再试答。<Button variant="secondary" onClick={()=>navigate('settings')}>去配置模型</Button></div>}
        <CustomerMarketField value={market} onChange={value=>{marketTouched.current=true;setMarket(value);}} disabled={running||busy}/><Field label="回复风格"><select disabled={running} value={workflowId} onChange={e=>setWorkflowId(e.target.value)}><option value="">通用客服 · 自然简洁</option>{availableWorkflows.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
        <Field label="写一句客户可能会问的话" hint="尽量换一种说法，例如“苹果电脑能用吗”，不要只复制资料标题。"><textarea rows={3} maxLength={4000} value={question} disabled={running} onChange={e=>setQuestion(e.target.value)} placeholder="例如：你们的产品多少钱？适合我们公司吗？"/></Field>
        <details><summary>补充这位客户的聊天上文（可选，测试追问和话题切换）</summary><Field label="最近对话" hint="每行一条，以“客户：”或“我方：”开头，最多 12 条。不要放入其他客户的聊天。"><textarea rows={4} maxLength={12000} disabled={running} value={historyText} onChange={e=>setHistoryText(e.target.value)} placeholder={'客户：想了解企业 AI 培训\n我方：您希望先改善哪类工作？'}/></Field></details><div className="coach-suggestions">{suggested.map(q=><button key={q} disabled={running} onClick={()=>setQuestion(q)}>{q}</button>)}</div>
        <label className="model-consent"><input type="checkbox" checked={consent} disabled={running} onChange={e=>setConsent(e.target.checked)}/><strong>同意试答（要先勾选这里）</strong>：会把这个问题和相关资料发给回复模型，不会给任何外部客户发消息。</label>
        <div className="page-actions"><Button busy={running} disabled={busy||!ready||!consent||!question.trim()} onClick={()=>void answer([question.trim()])}><Sparkles size={16}/>试答这一个问题</Button><Button variant="secondary" disabled={busy||running||!ready||!consent||!suggested.length} onClick={()=>void answer(suggested)}>逐题试答上面 {suggested.length} 问</Button>{running&&<Button variant="secondary" onClick={()=>{cancel.current=true;setProgress('将在当前这一题结束后停止。');}}>停止后续试答</Button>}{!running&&(blocker||!question.trim())&&<span className="muted" role="note">{blocker||'先写一句客户可能会问的话，或点上面的示例问题。'}</span>}</div>
        {progress&&<p role="status" className="muted">{progress}</p>}{error&&<p role="alert" className="error-text">{error}</p>}
      </div>
    </section>
    <section className="panel coach-results"><div className="panel-head"><div><h2>看看回答是否符合你的业务</h2><p>你已确认 {view?.correct??0} 条答对，{view?.incorrect??0} 条需修改。人工核对数量不代表准确率或无人值守验收。</p></div></div>
      {!view?.records.length&&<div className="coach-body muted">还没有试答记录。上面选一个问题，就能看到回答和它参考的资料。</div>}
      {view?.records.map(r=><article className="coach-result" key={r.id}>
        <div className="page-actions"><strong>{r.question}</strong><span className="subtle-badge">{!r.current?'资料已变化 · 请重新试答':r.verdict==='correct'?'已确认答对':r.verdict==='incorrect'?'需要修改':'等待你核对'}</span></div>
        <p className="muted">{r.intent ? intentLabel(r.intent) : '旧记录 · 尚未记录话题判断'}</p>{!!r.history?.length&&<details><summary>本次使用的聊天上文</summary>{r.history.map((m,i)=><p key={i}>{m.direction==='incoming'?'客户':'我方'}：{m.text}</p>)}</details>}<p className="coach-answer">{r.answer}</p><small>{marketLabel[r.customerMarket??'unknown']} · 真实模型：{r.model} · {new Date(r.createdAt).toLocaleString()}</small>{(r.customerMarket??'unknown')==='unknown'&&<p className="dr-warning">这次按「客户市场未确认」试答：写着价格（元/¥/美元）的资料没有给咔哒参考，所以不会报价。把上面的「客户市场」改成「国内客户」再试一次。</p>}
        <details><summary>查看参考资料（{r.knowledgeIds.length} 条）</summary>{r.knowledgeIds.length?r.knowledgeIds.map(id=>{const k=state.knowledge.find(k=>k.id===id);return <div key={id} className="coach-source"><strong>{k?.title??'原资料已删除'}</strong><p>{k?.content}</p>{k&&<Button variant="secondary" disabled={running} onClick={()=>onFix(r.question,id)}>修改这条资料 / 补充问法</Button>}</div>;}):<p>{r.intent?.kind==='social'?'日常交流无需引用业务资料；检查是否自然回应，且没有夹带推销。':'没有找到依据。回答应澄清或说明需要人工确认，不能编造价格或政策。'}</p>}</details>
        <div className="page-actions"><Button variant="secondary" disabled={busy||running||!r.current} onClick={()=>void review(r.id,'correct')}><Check size={15}/>答对了</Button><Button variant="secondary" disabled={busy||running||!r.current} onClick={()=>void review(r.id,'incorrect')}>需要修改</Button><Button variant="secondary" disabled={running} onClick={()=>onFix(r.question)}>补充正确资料</Button><Button variant="ghost" disabled={running} onClick={()=>{setMarket(r.customerMarket??'unknown');setQuestion(r.question);setHistoryText((r.history??[]).map(m=>(m.direction==='incoming'?'客户：':'我方：')+m.text).join('\n'));document.getElementById('coach-practice')?.scrollIntoView({behavior:'smooth'});}}>重新试答此问</Button></div>
      </article>)}
    </section>
  </div>;
}
