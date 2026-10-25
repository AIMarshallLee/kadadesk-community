import test from 'node:test';
import assert from 'node:assert/strict';
import { marketFromRecipientMetadata } from '../shared/customer-market';
import { productMessage } from '../shared/product-copy';
import { isAllowedRequest } from '../desktop/guards';
test('recipient metadata policy never substitutes local timezone or treats missing facts as overseas',()=>{
  assert.equal(marketFromRecipientMetadata('Asia/Shanghai','zh-CN'),'domestic');
  assert.equal(marketFromRecipientMetadata('PRC','zh-Hans'),'domestic');
  assert.equal(marketFromRecipientMetadata('Asia/Shanghai','en-US'),'international');
  assert.equal(marketFromRecipientMetadata('America/New_York','zh-CN'),'international');
  assert.equal(marketFromRecipientMetadata('Asia/Shanghai','zh-TW'),'international');
  assert.equal(marketFromRecipientMetadata(undefined,'zh-CN'),'unknown');
  assert.equal(marketFromRecipientMetadata('Asia/Shanghai',undefined),'unknown');
});
test('product diagnostics use neutral app wording and all connection/guide routes are exposed',()=>{
  assert.equal(productMessage("Error invoking remote method 'flowdesk:example': Error: 请恢复聊天软件窗口。"),'请恢复目标应用窗口。');
  for(const [method,path] of [['PUT','/onboarding'],['GET','/knowledge/connections'],['PUT','/knowledge/connections'],['DELETE','/knowledge/connections'],['POST','/knowledge/connections/preview']])assert.equal(isAllowedRequest({method,path}),true);
});
