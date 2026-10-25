import {safeModelTiming} from '../shared/model-timing';
import type {ModelCallMetric} from './model-usage';
/** Memory only. A restart has a fresh start marker; empty samples do not mean zero latency. */
export function createModelTimingBuffer(now:()=>Date=()=>new Date()){
 const startedAt=now().toISOString();let completedRequests=0;const tokens={input:0,output:0};
 const samples:Array<ReturnType<typeof safeModelTiming>['samples'][number]>=[];
 return {record(metric:ModelCallMetric){
  const sample=safeModelTiming({samples:[{...metric,at:now().toISOString()}]}).samples[0];
  samples.push(sample);if(samples.length>30)samples.shift();completedRequests++;
  tokens.input+=metric.usage?.inputTokens??0;tokens.output+=metric.usage?.outputTokens??0;
 },read:()=>safeModelTiming({startedAt,completedRequests,samples}),
  /** 服务商报告的累计 token 数（没报告的调用按 0 计）。 */
  totals:()=>({requests:completedRequests,...tokens})};
}
export const receptionModelTiming=createModelTimingBuffer();
