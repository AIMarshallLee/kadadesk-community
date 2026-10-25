import { createHash } from 'node:crypto';
import type { Knowledge } from '../shared/types';
import { conversationHistory, type ConversationIntent, type ConversationTurn } from '../shared/conversation-intent';
import { knowledgeAvailable, retrieveKnowledge } from './knowledge';
import { businessNames } from './knowledge-query';
import { ACCOUNT_KINDS, modelFailureKind } from '../shared/model-errors';

type Group = { id:string; names:string[]; entries:Knowledge[] };
function groups(entries:Knowledge[]):Group[] {
  const result:Group[]=[];
  for(const entry of entries){
    const names=businessNames(entry.tags);
    const matches=result.filter(g=>names.length?g.names.some(n=>names.includes(n)):!g.names.length);
    const merged={id:'',names:[...new Set([...names,...matches.flatMap(g=>g.names)])],entries:[entry,...matches.flatMap(g=>g.entries)]};
    for(const g of matches)result.splice(result.indexOf(g),1);
    result.push(merged);
  }
  for(const g of result)g.id='business-'+createHash('sha256').update([...g.names].sort().join('\0')||'unclassified').digest('hex').slice(0,16);
  return result;
}
/** Rank by retrieval over the latest message, then the recent customer messages (a follow-up such as 「那黑色呢」 keeps its topic). */
function catalogRanking(approved:Knowledge[],query:string,history:ConversationTurn[]):Map<string,number> {
  const rank=new Map<string,number>();
  const questions=[query,...history.filter(turn=>turn.direction==='incoming').map(turn=>turn.text).reverse().slice(0,4)].map(q=>q.slice(0,4000)).filter(q=>q.trim());
  questions.forEach((question,round)=>{for(const [index,hit] of retrieveKnowledge(approved,{query:question,limit:40}).hits.entries())if(!rank.has(hit.id))rank.set(hit.id,round*100+index);});
  return rank;
}
export class ConversationRoutingError extends Error {
  constructor(reason:string){
    // A model account problem (key, balance, trial) needs the owner, not a retry: keep its next step instead.
    const kind=modelFailureKind(reason);
    super(kind&&ACCOUNT_KINDS.has(kind)?`话题判断暂未完成：${reason.replace(/[。.]$/,'')}。尚未生成回复。`:`话题判断暂未完成：${reason}。尚未生成回复，请稍后重试。`);this.name='ConversationRoutingError';
  }
}
export async function routeConversationKnowledge(input:{query:string;history?:ConversationTurn[];workflow?:{name:string;description:string;instructions:string};knowledge:Knowledge[];classify:(payload:string,signal:AbortSignal)=>Promise<string>;signal?:AbortSignal}) {
  const signal=input.signal??new AbortController().signal;
  const history=conversationHistory(input.history), approved=structuredClone(input.knowledge.filter(knowledgeAvailable)), catalogGroups=groups(approved);
  const ranking=catalogRanking(approved,input.query,history);
  // Retrieval rank first (latest message, then recent customer messages); everything else newest first, so a
  // freshly approved price is never pushed out of the catalog by years-old entries.
  const fresh=(k:Knowledge)=>Date.parse(k.approvedAt??k.updatedAt)||0;
  const entries=[...approved].sort((a,b)=>{const ra=ranking.get(a.id)??Infinity,rb=ranking.get(b.id)??Infinity;return ra!==rb?ra-rb:fresh(b)-fresh(a)||a.id.localeCompare(b.id);});
  let budget=0;
  const catalogEntries=entries.filter(k=>{const size=k.title.length+(k.question?.length??0)+Math.min(500,(k.aliases??[]).join(' ').length)+180;if(budget+size>24000)return false;budget+=size;return true;}).slice(0,80);
  const ids=new Set(catalogEntries.map(k=>k.id));
  // Many businesses: list only the ones with entries in this catalog page instead of refusing every message.
  const listed=catalogGroups.length>64?catalogGroups.filter(g=>g.entries.some(k=>ids.has(k.id))):catalogGroups;
  const catalog=listed.map(g=>({id:g.id,names:g.names.length?g.names:['未分类资料'],entries:g.entries.filter(k=>ids.has(k.id)).map(k=>({id:k.id,title:k.title,question:k.question??'',aliases:(k.aliases??[]).join(' / ').slice(0,500)}))}));
  let value:any;
  try {
    signal.throwIfAborted();
    // Only the selected enabled workflow is supplied by the callers. It is
    // fallback topic context, never a source of business facts or authority.
    const workflow=input.workflow?{name:input.workflow.name.slice(0,200),description:input.workflow.description.slice(0,500),instructions:input.workflow.instructions.slice(0,3000)}:undefined;
    const payload=JSON.stringify({latest:input.query.slice(0,4000),history,...(workflow?{workflow}:{}),catalog,complete:ids.size===approved.length});
    let raw=await input.classify(payload,signal);
    signal.throwIfAborted();
    // A truncated or prose-only verdict is a transport hiccup: ask once more before giving up.
    if(!/\{[\s\S]*\}/.test(raw)){raw=await input.classify(payload,signal);signal.throwIfAborted();}
    // Models sometimes wrap the JSON verdict in prose; take the outermost object only.
    const body=raw.replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/,'');
    try{value=JSON.parse(body);}catch(parseError){const a=body.indexOf('{'),b=body.lastIndexOf('}');
      if(typeof process!=='undefined'&&process.env?.FLOWDESK_DIAG_DIR){try{const fs=await import('node:fs'),path=await import('node:path');fs.appendFileSync(path.join(process.env.FLOWDESK_DIAG_DIR,'kadadesk-draft-veto.jsonl'),JSON.stringify({at:new Date().toISOString(),site:'routing-parse',rawLength:raw.length,startsBrace:body.trim().startsWith('{'),endsBrace:body.trim().endsWith('}'),hasObject:a>=0&&b>a})+'\n');}catch{/* best effort */}}
      if(a<0||b<=a)throw parseError;value=JSON.parse(body.slice(a,b+1));}
  } catch(error) {
    signal.throwIfAborted();
    const status=error instanceof Error?/HTTP\s+(\d{3})/.exec(error.message)?.[1]:undefined;
    if(typeof process!=='undefined'&&process.env?.FLOWDESK_DIAG_DIR){try{const fs=await import('node:fs'),path=await import('node:path');fs.appendFileSync(path.join(process.env.FLOWDESK_DIAG_DIR,'kadadesk-draft-veto.jsonl'),JSON.stringify({at:new Date().toISOString(),site:'routing-error',name:error instanceof Error?error.name:typeof error,http:status??null,timeout:error instanceof Error&&/超过|超时|timeout/i.test(error.message)})+'\n');}catch{/* best effort */}}
    // Keep the model layer's advice and the provider's own words (already cleaned of URLs and keys).
    const detail=error instanceof Error?/^视觉模型请求失败（HTTP \d{3}）：([\s\S]{1,400})$/.exec(error.message)?.[1]?.replace(/[。.]$/,''):undefined;
    throw new ConversationRoutingError(status?`模型服务拒绝请求（HTTP ${status}）${detail?'：'+detail:''}`:'模型未返回有效判断');
  }
  // Transport/schema errors are not evidence that the customer's question is
  // ambiguous. Let the pre-input queue retry instead of sending a made-up ask.
  if(typeof process!=='undefined'&&process.env?.FLOWDESK_DIAG_DIR){try{const fs=await import('node:fs'),path=await import('node:path');fs.appendFileSync(path.join(process.env.FLOWDESK_DIAG_DIR,'kadadesk-draft-veto.jsonl'),JSON.stringify({at:new Date().toISOString(),site:'routing',kind:typeof value?.kind==='string'?value.kind.slice(0,20):typeof value?.kind,confidence:value?.confidence,topics:Array.isArray(value?.topics)?value.topics.length:typeof value?.topics,catalog:ids.size})+'\n');}catch{/* best effort */}}
  // A model naming more than three topics is still a valid routing; keep the first three.
  if(value&&Array.isArray(value.topics)&&value.topics.length>3)value={...value,topics:value.topics.slice(0,3)};
  if(!value||!['social','business','clarify'].includes(value.kind)||!Number.isFinite(value.confidence)||value.confidence<(value.kind==='clarify'&&Array.isArray(value.topics)&&!value.topics.length?.5:value.kind==='business'?.7:.85)||value.confidence>1||!Array.isArray(value.topics)||value.topics.length>3)throw new ConversationRoutingError('判断结构或置信度未通过核验');
  if(value.kind!=='business'){
    if(value.topics.length)throw new ConversationRoutingError('判断结构不一致');
    return {intent:{kind:value.kind as 'social'|'clarify',...(value.kind==='social'&&['family','friend','partner'].includes(value.relation)?{relation:value.relation as 'family'|'friend'|'partner'}:{}),topics:[],reason:value.kind==='social'?'日常交流':'需要确认所问事项'},knowledge:[] as Knowledge[]};
  }
  if(!value.topics.length)throw new ConversationRoutingError('未返回业务引用');
  const knowledge:Knowledge[]=[],topics:ConversationIntent['topics']=[];
  for(const topic of value.topics){
    const group=listed.find(g=>g.id===topic?.businessId);
    if(!group||typeof topic.query!=='string'||!topic.query.trim()||topic.query.length>1000||!Array.isArray(topic.entryIds)||topic.entryIds.length>4||topic.entryIds.some((id:unknown)=>typeof id!=='string'||!ids.has(id)||!group.entries.some(k=>k.id===id)))throw new ConversationRoutingError('业务或知识引用无效');
    // Without explicit entry IDs, retrieve matching facts only inside the selected group: a tagged business or
    // the untagged material (most shops never tag their knowledge).
    const selected=topic.entryIds.map((id:string)=>group.entries.find(k=>k.id===id)!);
    const retrieved=!selected.length?retrieveKnowledge(group.entries,{query:topic.query}).hits.slice(0,3).map(h=>group.entries.find(k=>k.id===h.id)!):[];
    for(const k of [...selected,...retrieved])if(!knowledge.some(old=>old.id===k.id)&&knowledge.length<12)knowledge.push(k);
    topics.push({business:group.names.find(n=>/[\u4e00-\u9fff]/.test(n))??group.names[0]??'当前资料',query:topic.query});
  }
  let length=0;const included=knowledge.filter(k=>{length+=k.title.length+k.content.length+20;return length<=20000;});
  return {intent:{kind:'business' as const,topics,reason:included.length?'已按当前话题选择业务资料':'已识别业务，但资料未覆盖问题'},knowledge:included};
}
