/**
 * 3D 展厅预约记入客户档案纯规则逻辑 (shared/showroom-leads-customer.ts)
 * - 每条预约在客户档案新建或按手机号合并
 * - 来源写「3D 展厅」
 * - 备注写小区、面积、需求、看的案例
 * - 进「今日跟进」清单，由人来跟进
 * - 本期不自动加好友、不主动发消息
 */

import {
  type CustomerProfile,
  type CustomersStore,
  currentValue,
  findProfile,
  newProfile,
  addFacts,
  addNote,
  MAX_PROFILES,
} from './customers';
import type { ShowroomLead } from './showroom-leads';

export function ingestShowroomLead(
  store: CustomersStore,
  lead: ShowroomLead,
  at: string
): { profile: CustomerProfile; isNew: boolean } {
  const cleanPhone = lead.phone ? String(lead.phone).replace(/\D/g, '') : '';
  const cleanName = lead.name?.trim() || (cleanPhone ? `客户${cleanPhone.slice(-4)}` : '展厅客户');

  // 优先按手机号合并；其次按名字查找
  let p = cleanPhone
    ? store.profiles.find(x => currentValue(x, 'phone') === cleanPhone)
    : undefined;

  if (!p) {
    p = findProfile(store, cleanName);
  }

  let isNew = false;
  if (!p) {
    if (store.profiles.length >= MAX_PROFILES) {
      throw new Error('客户档案已满，无法新建客户');
    }
    p = newProfile(cleanName, 'desk', at);
    store.profiles.push(p);
    isNew = true;
  }

  // 1. 记来源与基础字段
  const factsToAdd: Array<{ field: string; value: string }> = [
    { field: 'source', value: '3D 展厅' },
  ];
  if (cleanPhone && currentValue(p, 'phone') !== cleanPhone) {
    factsToAdd.push({ field: 'phone', value: cleanPhone });
  }

  addFacts(p, factsToAdd, 'import', at);

  // 2. 备注写小区、面积、需求、看的案例（优先显示案例标题）
  const caseDisplay = (lead.caseTitle ?? lead.caseId ?? '').trim();
  const noteParts = [
    lead.community ? `小区：${lead.community}` : '',
    lead.area ? `面积：${lead.area}㎡` : '',
    lead.note ? `需求：${lead.note}` : '',
    caseDisplay ? `看的案例：${caseDisplay}` : '',
  ].filter(Boolean);
  const noteText = `【3D 展厅预约】${noteParts.join('，') || '留下联系方式'}`;
  addNote(p, noteText, 'import', at);

  // 3. 进「今日跟进」清单，由人来跟进
  p.nextFollowUp = {
    at,
    reason: `3D展厅预约量房${lead.community ? `（${lead.community}）` : ''}`,
    source: 'import',
  };
  p.updatedAt = at;

  return { profile: p, isNew };
}
