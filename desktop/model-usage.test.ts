import assert from 'node:assert/strict';
import test from 'node:test';
import {parseModelUsage, modelCallStage} from './model-usage';

test('usage preserves provider totals and subset counts without double charging',()=>{
  assert.deepEqual(parseModelUsage({prompt_tokens:1000,completion_tokens:200,total_tokens:1200,prompt_tokens_details:{cached_tokens:500,image_tokens:800},completion_tokens_details:{reasoning_tokens:150}}),{
    inputTokens:1000,outputTokens:200,totalTokens:1200,cachedInputTokens:500,imageInputTokens:800,reasoningOutputTokens:150,
  });
  const alternate=parseModelUsage({input_tokens:100,output_tokens:30,prompt_cache_hit_tokens:20,output_tokens_details:{reasoning_tokens:10}});
  assert.equal(alternate.cachedInputTokens,20);assert.equal(alternate.inputTokens,100);assert.equal(alternate.totalTokens,null);
});
test('missing, malformed and negative counts remain unknown; explicit zero remains zero',()=>{
  for(const value of [undefined,null,'secret',{prompt_tokens:-1,completion_tokens:'20',total_tokens:Infinity,prompt_tokens_details:{cached_tokens:1.5,image_tokens:Number.MAX_SAFE_INTEGER+1}}]){
    assert.ok(Object.values(parseModelUsage(value)).every(n=>n===null));
  }
  assert.equal(parseModelUsage({prompt_tokens:0}).inputTokens,0);
  assert.equal(modelCallStage('FLOWDESK_WHATSAPP_NAV. private data'),'WHATSAPP_NAV');
  assert.equal(modelCallStage('FLOWDESK_CHAT_EDITOR. private data'),'CHAT_EDITOR');
  assert.equal(modelCallStage('KADADESK_CONVERSATION_ROUTING. private data'),'CONVERSATION_ROUTING');
  assert.equal(modelCallStage('private data'),'OTHER');
});
