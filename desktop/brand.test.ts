import test from 'node:test';
import assert from 'node:assert/strict';
import { isAssistantWindow } from '../shared/brand';
test('window selection excludes renamed assistant and legacy versions without excluding unrelated titles',()=>{
 for(const title of ['咔哒 — 私域副驾','咔哒','kadadesk','FlowDesk — old','GhostDesk · old'])assert.equal(isAssistantWindow(title),true,title);
 for(const title of ['聊天软件','备忘录','合同 kadadesk 客户','FlowDesk客户需求'])assert.equal(isAssistantWindow(title),false,title);
});
