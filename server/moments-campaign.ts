import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ApiError } from './autopilot.ts';

// Personal WeChat Moments V1.0: local human-operated task ledger. No WeChat credentials,
// account discovery, browser automation, background sending or platform endpoints.
export type DeviceKind = 'windows' | 'mac' | 'phone';
export type MomentsAccount = {
  id: string; name: string; device: DeviceKind; deviceLabel: string;
  enabled: boolean; version: number; createdAt: string; updatedAt: string;
};
export type MomentsAsset = { id: string; name: string; mime: string; size: number; sha256: string; createdAt: string };
export type MomentsContent = {
  id: string; title: string; text: string; assetIds: string[]; version: number; updatedAt: string; createdAt: string;
};
export type MomentsCampaign = {
  id: string; contentId: string; contentVersion: number; accountIds: string[]; createdAt: string;
};
export type MomentsJobStatus = 'review' | 'approved' | 'handoff' | 'reported' | 'verified' | 'unknown' | 'skipped' | 'stale';
export type MomentsJob = {
  id: string; campaignId: string; accountId: string; accountVersion: number;
  accountName: string; deviceLabel: string; contentTitle: string;
  contentId: string; contentVersion: number; text: string; assetIds: string[];
  visibility: string; status: MomentsJobStatus; fingerprint: string; approvedFingerprint?: string;
  handoffAt?: string; reportedAt?: string; verifiedAt?: string; updatedAt: string; createdAt: string;
};
type Data = { schema: 1; accounts: MomentsAccount[]; assets: MomentsAsset[]; content: MomentsContent[]; campaigns: MomentsCampaign[]; jobs: MomentsJob[] };
const now = () => new Date().toISOString();
function required(v: unknown, name: string, max = 200) {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new ApiError(400, name + '不能为空或过长');
  return v.trim();
}
function ids(v: unknown, name: string, max: number) {
  if (!Array.isArray(v) || !v.length || v.length > max || v.some(x => typeof x !== 'string' || !x.trim() || x.length > 100) || new Set(v).size !== v.length)
    throw new ApiError(400, name + '必须为不重复的有效ID列表');
  return v as string[];
}
function assetRefs(v: unknown) {
  if (!Array.isArray(v) || v.length > 9 || v.some(x=>typeof x !== 'string' || !x.trim() || x.length > 100) || new Set(v).size !== v.length)
    throw new ApiError(400, '配图必须是不超过9张且不重复的ID列表');
  return v as string[];
}
function fingerprint(job: Pick<MomentsJob, 'accountId' | 'accountVersion' | 'contentId' | 'contentVersion' | 'text' | 'assetIds' | 'visibility'>, assets: MomentsAsset[]) {
  const hashes = job.assetIds.map(id => assets.find(a => a.id === id)?.sha256 ?? 'missing');
  return createHash('sha256').update(JSON.stringify([job.accountId, job.accountVersion, job.contentId, job.contentVersion, job.text, hashes, job.visibility])).digest('hex');
}
function checkData(value: unknown): asserts value is Data {
  const d = value as Data;
  if (!d || d.schema !== 1 || !Array.isArray(d.accounts) || !Array.isArray(d.assets) || !Array.isArray(d.content) || !Array.isArray(d.campaigns) || !Array.isArray(d.jobs))
    throw new Error('朋友圈运营数据结构无法识别；原始文件已保留');
}

export async function createMomentsOperations(dataDir: string) {
  await mkdir(dataDir, { recursive: true });
  const assetDir = join(dataDir, 'moments-assets');
  const file = join(dataDir, 'moments-ops-v1.json');
  let data: Data;
  try { data = JSON.parse(await readFile(file, 'utf8')); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    data = { schema: 1, accounts: [], assets: [], content: [], campaigns: [], jobs: [] };
  }
  checkData(data);
  let tail: Promise<unknown> = Promise.resolve();
  const locked = <T>(effect: () => Promise<T>) => {
    const operation = tail.then(effect);
    tail = operation.catch(() => undefined);
    return operation;
  };
  async function persist() {
    const tmp = file + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
      await rename(tmp, file);
    } catch (e) { await unlink(tmp).catch(() => {}); throw e; }
  }
  const mutate = <T>(change: () => Promise<T> | T) => locked(async () => {
    const prior = structuredClone(data);
    try {
      const result = await change();
      await persist();
      return structuredClone(result);
    } catch (e) { data = prior; throw e; }
  });
  const account = (id: string) => {
    const found = data.accounts.find(a => a.id === id);
    if (!found) throw new ApiError(404, '微信账号不存在');
    return found;
  };
  const item = (id: string) => {
    const found = data.content.find(c => c.id === id);
    if (!found) throw new ApiError(404, '朋友圈内容不存在');
    return found;
  };
  const job = (id: string) => {
    const found = data.jobs.find(j => j.id === id);
    if (!found) throw new ApiError(404, '发布任务不存在');
    return found;
  };
  function assertCurrent(j: MomentsJob) {
    if (!account(j.accountId).enabled) throw new ApiError(409, '账号已停用，禁止交接');
    if (account(j.accountId).version !== j.accountVersion || item(j.contentId).version !== j.contentVersion || j.status === 'stale')
      throw new ApiError(409, '账号或内容已变更，需要重新创建新版本的发布任务');
  }
  function view() {
    return {
      accounts: structuredClone(data.accounts),
      assets: structuredClone(data.assets),
      content: structuredClone(data.content),
      campaigns: structuredClone(data.campaigns),
      jobs: structuredClone(data.jobs),
      stats: {
        accounts: data.accounts.filter(a => a.enabled).length,
        pending: data.jobs.filter(j => ['review','approved','handoff','reported','stale','unknown'].includes(j.status)).length,
        reported: data.jobs.filter(j => j.status === 'reported').length,
        verified: data.jobs.filter(j => j.status === 'verified').length,
        unknown: data.jobs.filter(j => j.status === 'unknown').length,
      },
      provider: { personalWechatApi: false, autoPublishEnabled: false, postingVerifiedAutomatically: false },
    };
  }
  async function handle(method: string, path: string, body: Record<string, unknown> = {}): Promise<unknown> {
    if (method === 'GET' && path === '/moments') return view();
    if (method === 'POST' && path === '/moments/accounts') return mutate(() => {
      if (data.accounts.length >= 100) throw new ApiError(400, '最多登记100个账号');
      if (body.ownedOrAuthorized !== true) throw new ApiError(400, '请先确认账号属于本人或已获明确授权');
      const device = body.device as DeviceKind;
      if (!['windows','mac','phone'].includes(device)) throw new ApiError(400, '设备类型无效');
      const name = required(body.name, '账号备注', 80);
      if (data.accounts.some(a => a.name === name)) throw new ApiError(409, '账号备注重复，请使用唯一名称');
      const t = now();
      const created: MomentsAccount = { id: randomUUID(), name, device, deviceLabel: required(body.deviceLabel, '设备名称', 120),
        enabled: true, version: 1, createdAt: t, updatedAt: t };
      data.accounts.push(created); return created;
    });
    if (method === 'POST' && path === '/moments/accounts/batch') return mutate(() => {
      if (body.ownedOrAuthorized !== true) throw new ApiError(400, '请确认全部账号为本人所有或已经获得授权');
      const entries = body.accounts;
      if (!Array.isArray(entries) || !entries.length || entries.length > 30 || data.accounts.length + entries.length > 100)
        throw new ApiError(400, '每批最多登记30个账号，总计最多100个');
      const existingNames = new Set(data.accounts.map(a=>a.name));
      const added: MomentsAccount[] = [];
      for (const e of entries) {
        if (!e || typeof e !== 'object' || Array.isArray(e)) throw new ApiError(400, '账号记录无效');
        const entry = e as Record<string,unknown>;
        const name = required(entry.name, '账号备注', 80);
        if (existingNames.has(name)) throw new ApiError(409, '账号备注重复：' + name);
        if (!['windows','mac','phone'].includes(entry.device as string)) throw new ApiError(400, '设备类型无效');
        const deviceLabel = required(entry.deviceLabel, '设备名称', 120);
        existingNames.add(name);
        const t = now();
        added.push({ id: randomUUID(), name, device: entry.device as DeviceKind, deviceLabel,
          enabled: true, version: 1, createdAt: t, updatedAt: t });
      }
      data.accounts.push(...added);
      return { added: added.length, accounts: added };
    });
    const accMatch = path.match(/^\/moments\/accounts\/([^/]+)$/);
    if (method === 'PUT' && accMatch) return mutate(() => {
      const a = account(accMatch[1]);
      if (body.ownedOrAuthorized !== true) throw new ApiError(400, '请确认继续具备账号操作授权');
      if (body.device !== undefined && !['windows','mac','phone'].includes(body.device as string)) throw new ApiError(400, '设备类型无效');
      if (body.enabled !== undefined && typeof body.enabled !== 'boolean') throw new ApiError(400, '账号状态无效');
      const name = body.name === undefined ? a.name : required(body.name, '账号备注', 80);
      if (data.accounts.some(x => x.id !== a.id && x.name === name)) throw new ApiError(409, '账号备注重复');
      const device = body.device === undefined ? a.device : body.device as DeviceKind;
      const deviceLabel = body.deviceLabel === undefined ? a.deviceLabel : required(body.deviceLabel, '设备名称', 120);
      const enabled = body.enabled === undefined ? a.enabled : body.enabled;
      if (name !== a.name || device !== a.device || deviceLabel !== a.deviceLabel || enabled !== a.enabled) {
        Object.assign(a, { name, device, deviceLabel, enabled, version: a.version + 1, updatedAt: now() });
        for (const j of data.jobs) if (j.accountId === a.id && ['review','approved','handoff'].includes(j.status)) { j.status = 'stale'; j.updatedAt = now(); }
      }
      return a;
    });
    if (method === 'POST' && path === '/moments/assets') return locked(async () => {
      if (data.assets.length >= 1000) throw new ApiError(400, '素材数量已达上限，请先归档');
      const name = required(body.name, '图片文件名', 160);
      const raw = body.dataUrl;
      if (typeof raw !== 'string') throw new ApiError(400, '请选择图片文件');
      const matched = /^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=]+)$/.exec(raw);
      if (!matched || raw.length > 5_600_000) throw new ApiError(400, '仅支持小于4MB的PNG/JPEG/WebP图片');
      const bytes = Buffer.from(matched[2], 'base64');
      if (!bytes.length || bytes.length > 4 * 1024 * 1024 || bytes.toString('base64') !== matched[2])
        throw new ApiError(400, '图片编码或大小无效');
      const mime = matched[1];
      const magic = mime === 'image/png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
        : mime === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        : bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP';
      if (!magic) throw new ApiError(400, '图片格式与文件内容不一致');
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const prior = data.assets.find(a => a.sha256 === sha256);
      if (prior) return structuredClone(prior);
      await mkdir(assetDir, { recursive: true });
      const created: MomentsAsset = { id: randomUUID(), name, mime, size: bytes.length, sha256, createdAt: now() };
      const target = join(assetDir, created.id + '.bin');
      await writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
      data.assets.push(created);
      try { await persist(); return structuredClone(created); }
      catch (e) { data.assets.pop(); await unlink(target).catch(() => {}); throw e; }
    });
    const assetMatch = path.match(/^\/moments\/assets\/([a-f0-9-]+)$/);
    if (method === 'GET' && assetMatch) {
      const asset = data.assets.find(x => x.id === assetMatch[1]);
      if (!asset) throw new ApiError(404, '素材不存在');
      const bytes = await readFile(join(assetDir, asset.id + '.bin'));
      if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new ApiError(409, '图片校验失败，请检查文件');
      return { ...asset, dataUrl: 'data:' + asset.mime + ';base64,' + bytes.toString('base64') };
    }
    if (method === 'POST' && path === '/moments/content') return mutate(() => {
      if (data.content.length >= 500) throw new ApiError(400, '内容数量已达上限');
      const assetIds = body.assetIds === undefined ? [] : assetRefs(body.assetIds);
      if (assetIds.some(id => !data.assets.some(a => a.id === id))) throw new ApiError(400, '图片引用不存在');
      const t = now();
      const created: MomentsContent = { id: randomUUID(), title: required(body.title, '内容标题', 120),
        text: required(body.text, '朋友圈正文', 5000), assetIds: [...assetIds], version: 1, createdAt: t, updatedAt: t };
      data.content.push(created); return created;
    });
    const contentMatch = path.match(/^\/moments\/content\/([^/]+)$/);
    if (method === 'PUT' && contentMatch) return mutate(() => {
      const c = item(contentMatch[1]);
      if (body.expectedVersion !== c.version) throw new ApiError(409, '内容版本已更新，请刷新后再编辑');
      const title = body.title === undefined ? c.title : required(body.title, '内容标题', 120);
      const text = body.text === undefined ? c.text : required(body.text, '朋友圈正文', 5000);
      const assetIds = body.assetIds === undefined ? c.assetIds : assetRefs(body.assetIds);
      if (assetIds.some(id => !data.assets.some(a => a.id === id))) throw new ApiError(400, '图片引用不存在');
      if (title !== c.title || text !== c.text || JSON.stringify(assetIds) !== JSON.stringify(c.assetIds)) {
        Object.assign(c, { title, text, assetIds: [...assetIds], version: c.version + 1, updatedAt: now() });
        for (const j of data.jobs) if (j.contentId === c.id && ['review','approved','handoff'].includes(j.status)) { j.status = 'stale'; j.updatedAt = now(); }
      }
      return c;
    });
    if (method === 'POST' && path === '/moments/campaigns') return mutate(() => {
      const c = item(required(body.contentId, '内容', 100));
      const accountIds = ids(body.accountIds, '目标账号', 100);
      for (const id of accountIds) {
        if (!account(id).enabled) throw new ApiError(409, '包含已停用账号');
        if (data.jobs.some(j => j.accountId === id && j.contentId === c.id && j.contentVersion === c.version && j.status !== 'skipped'))
          throw new ApiError(409, '该内容版本已经分配过此账号，请查看原任务，避免重复发布');
      }
      const t = now(); const created: MomentsCampaign = { id: randomUUID(), contentId: c.id, contentVersion: c.version,
        accountIds: [...accountIds], createdAt: t };
      data.campaigns.push(created);
      for (const aId of accountIds) {
        const a = account(aId);
        const j: MomentsJob = { id: randomUUID(), campaignId: created.id, accountId: a.id,
          accountVersion: a.version, accountName: a.name, deviceLabel: a.deviceLabel, contentTitle: c.title,
          contentId: c.id, contentVersion: c.version,
          text: c.text, assetIds: [...c.assetIds], visibility: '发布前手动核对可见范围', status: 'review',
          fingerprint: '', createdAt: t, updatedAt: t };
        j.fingerprint = fingerprint(j, data.assets); data.jobs.push(j);
      }
      return created;
    });
    const jobMatch = path.match(/^\/moments\/jobs\/([^/]+)(?:\/(approve|handoff|report|verify|resolve-unknown))?$/);
    if (jobMatch && (method === 'POST' || method === 'PUT')) return mutate(() => {
      const j = job(jobMatch[1]), action = jobMatch[2];
      if (method === 'PUT' && !action) {
        if (!['review','approved'].includes(j.status)) throw new ApiError(409, '该任务已经开始交接，请勿编辑');
        assertCurrent(j);
        if (body.expectedFingerprint !== j.fingerprint) throw new ApiError(409, '草稿已变化，请刷新重试');
        if (body.text !== undefined) j.text = required(body.text, '账号专属文案', 5000);
        if (body.visibility !== undefined) j.visibility = required(body.visibility, '可见范围提醒', 300);
        j.fingerprint = fingerprint(j, data.assets); j.approvedFingerprint = undefined;
        j.status = 'review'; j.updatedAt = now(); return j;
      }
      if (method !== 'POST') throw new ApiError(404, '发布操作不存在');
      if (action === 'approve') {
        if (j.status !== 'review') throw new ApiError(409, '只能审核待审核任务');
        assertCurrent(j);
        if (body.confirmed !== true || body.expectedFingerprint !== j.fingerprint)
          throw new ApiError(409, '请核对当前账号、正文、图片与可见范围后再审核');
        j.approvedFingerprint = j.fingerprint;
        j.status = 'approved';
      } else if (action === 'handoff') {
        if (j.status !== 'approved') throw new ApiError(409, '任务尚未审核或已交接，禁止重复');
        assertCurrent(j);
        if (body.accountId !== j.accountId || body.identityConfirmed !== true || body.expectedFingerprint !== j.approvedFingerprint)
          throw new ApiError(409, '必须明确确认当前原生微信登录的是目标账号，且素材与审核内容一致');
        j.status = 'handoff'; j.handoffAt = now();
      } else if (action === 'report') {
        if (j.status !== 'handoff') throw new ApiError(409, '需要先交接后才能登记结果');
        if (body.accountId !== j.accountId || body.operatorConfirmed !== true || !['reported','unknown','skipped'].includes(body.outcome as string))
          throw new ApiError(400, '请由操作员明确说明发布结果');
        j.status = body.outcome as MomentsJobStatus; j.reportedAt = now();
      } else if (action === 'verify') {
        if (j.status !== 'reported') throw new ApiError(409, '只能核实已人工报告发布的任务');
        if (body.accountId !== j.accountId || body.timelineConfirmed !== true || body.expectedFingerprint !== j.approvedFingerprint)
          throw new ApiError(409, '必须核对目标账号本人朋友圈中的实际内容');
        j.status = 'verified'; j.verifiedAt = now();
      } else if (action === 'resolve-unknown') {
        if (j.status !== 'unknown') throw new ApiError(409, '只有结果不确定的任务可以人工解除');
        if (body.accountId !== j.accountId || body.confirmedNotPublished !== true)
          throw new ApiError(409, '必须由操作员核实该账号朋友圈中确实没有发布，才允许重试');
        assertCurrent(j);
        j.status = 'review'; j.approvedFingerprint = undefined; j.handoffAt = undefined; j.reportedAt = undefined;
      } else throw new ApiError(404, '发布操作不存在');
      j.updatedAt = now(); return j;
    });
    throw new ApiError(404, '朋友圈运营接口不存在');
  }
  return { handle };
}
