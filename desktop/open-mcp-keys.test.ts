import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_CLIENTS, clientId, identify, sanitizeClients, validLabel } from './open-mcp-keys';

const client = (id: string, key: string, appTasks = false, configWrite = false, skipConfirm = false) => ({ id, label: id.toUpperCase(), key, appTasks, configWrite, skipConfirm, createdAt: '2026-10-01T00:00:00.000Z' });
const key = (seed: string) => `${seed}-${'k'.repeat(24)}`;

test('客户端名称：去掉首尾空白，1–30 字，不能有隐藏字符或仿冒括号', () => {
  assert.equal(validLabel('  Hermes  '), 'Hermes');
  assert.throws(() => validLabel(''), /名称/);
  assert.throws(() => validLabel(42), /名称/);
  assert.throws(() => validLabel('x'.repeat(31)), /30/);
  assert.throws(() => validLabel(`Her${String.fromCodePoint(0x200b)}mes`), /不可见/);
  assert.throws(() => validLabel('【咔哒】'), /括号/);
});

test('客户端编号：工具名加随机后缀，撞上已有编号就换一个，不会占用 default', () => {
  assert.match(clientId([], 'hermes'), /^hermes-[0-9a-f]{4}$/);
  assert.equal(clientId([], 'hermes', () => '3fa9'), 'hermes-3fa9');
  const suffixes = ['3fa9', '3fa9', 'b2c1'];
  assert.equal(clientId(['hermes-3fa9'], 'hermes', () => suffixes.shift()!), 'hermes-b2c1');
  assert.equal(clientId([], 'Not A Slug!', () => 'aaaa'), 'client-aaaa');
  assert.equal(clientId([], 'default', () => 'aaaa'), 'client-aaaa');
  assert.equal(clientId([], 'constructor', () => 'aaaa'), 'constructor-aaaa');
  assert.throws(() => clientId(['hermes-0000'], 'hermes', () => '0000'), /无法生成/);
});

test('按 Bearer 头识别调用方：默认密钥、命名客户端、未知或缺失的密钥', () => {
  const clients = [client('hermes', key('hermes'), true), client('codex', key('codex'))];
  assert.deepEqual(identify(`Bearer ${key('default')}`, key('default'), clients), { id: 'default', label: '开放接口', appTasks: false, configWrite: false, skipConfirm: false });
  assert.deepEqual(identify(`Bearer ${key('hermes')}`, key('default'), clients), { id: 'hermes', label: 'HERMES', appTasks: true, configWrite: false, skipConfirm: false });
  assert.deepEqual(identify(`bearer ${key('codex')}`, key('default'), clients), { id: 'codex', label: 'CODEX', appTasks: false, configWrite: false, skipConfirm: false });
  assert.equal(identify('Bearer nope', key('default'), clients), undefined);
  assert.equal(identify(undefined, key('default'), clients), undefined);
  assert.equal(identify('Bearer ', key('default'), clients), undefined);
  assert.equal(identify(key('hermes'), key('default'), clients), undefined);
});

test('读取设置时丢掉无效、重复或与默认密钥相同的客户端记录，且最多保留上限个；名称不合规时改用编号而不丢密钥', () => {
  const kept = sanitizeClients([
    client('hermes', key('a'), true), client('hermes', key('b')), { id: 'bad id', label: 'x', key: key('c') },
    client('codex', ''), client('default', key('d')), client('cursor', key('a')), client('gemini', key('default')), null, 'x',
    { ...client('trae', key('e')), label: '【旧名称】' },
  ], key('default'));
  assert.deepEqual(kept.map(item => [item.id, item.label]), [['hermes', 'HERMES'], ['trae', 'trae']]);
  assert.equal(kept[0].appTasks, true);
  assert.equal(sanitizeClients('nope', key('default')).length, 0);
  assert.equal(sanitizeClients(Array.from({ length: MAX_CLIENTS + 5 }, (_, i) => client(`c${i}`, key(`k${i}`))), key('default')).length, MAX_CLIENTS);
});

test('修改设置权限按客户端保存：默认关闭；「不经确认」只在有修改权限时生效；旧记录没有这两项时视为关闭', () => {
  const clients = [client('cursor', key('cursor'), false, true, true), client('trae', key('trae'), false, false, true)];
  assert.deepEqual(identify(`Bearer ${key('cursor')}`, key('default'), clients), { id: 'cursor', label: 'CURSOR', appTasks: false, configWrite: true, skipConfirm: true });
  assert.deepEqual(identify(`Bearer ${key('trae')}`, key('default'), clients), { id: 'trae', label: 'TRAE', appTasks: false, configWrite: false, skipConfirm: false });
  const kept = sanitizeClients([{ id: 'old', label: 'Old', key: key('old'), appTasks: true, createdAt: '2026-01-01T00:00:00.000Z' }, client('trae', key('trae'), false, false, true), client('cursor', key('cursor'), false, true, true)], key('default'));
  assert.deepEqual(kept.map(item => [item.id, item.configWrite, item.skipConfirm]), [['old', false, false], ['trae', false, false], ['cursor', true, true]]);
});
