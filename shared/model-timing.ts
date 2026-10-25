/** Closed timing vocabulary; no prompts, endpoints, model names or provider output. */
const stages=['CHAT_SCENE','CHAT_EDITOR','IME_SCENE','NAVIGATION','SEARCH','WHATSAPP','WHATSAPP_NAV','WEBMAIL','MOMENTS','CHAT_REPLY','LEARNING','CONVERSATION_ROUTING','OTHER'];
const results=['response','error','cancelled','timeout'];
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const count=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
const time=(value:unknown)=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)&&Number.isFinite(Date.parse(value))?value:null;
export function safeModelTiming(value:unknown){
 const input=object(value);
 return {scope:'current-process-openai-compatible-reception',startedAt:time(input.startedAt),completedRequests:count(input.completedRequests),samples:(Array.isArray(input.samples)?input.samples:[]).slice(-30).map(value=>{
  const row=object(value),status=count(row.httpStatus);
  return {at:time(row.at),stage:typeof row.stage==='string'&&stages.includes(row.stage)?row.stage:'unknown',elapsedMs:count(row.elapsedMs),result:typeof row.result==='string'&&results.includes(row.result)?row.result:'unknown',httpStatus:status!==null&&status>=100&&status<=599?status:null};
 })};
}
