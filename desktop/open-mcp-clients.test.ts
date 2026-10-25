import assert from 'node:assert/strict';
import test from 'node:test';
import { CLIENT_KEY_PLACEHOLDER, openMcpClientSnippets, type OpenMcpStdioLaunch } from '../shared/open-mcp-clients';

const url = 'http://127.0.0.1:8811/mcp';
const token = 'SYNTHETIC_token_value_123';
const stdio: OpenMcpStdioLaunch = { command: 'node', script: '/Applications/kadadesk.app/Contents/Resources/app.asar.unpacked/desktop-build/kadadesk-mcp.cjs', dataDir: ['/', 'Users', '/'].join('') + 'synthetic/Library/Application Support/FlowDesk' };
const pick = (id: string, withStdio = true) => {
  const snippet = openMcpClientSnippets({ url, token, ...(withStdio ? { stdio } : {}) }).find(x => x.id === id);
  assert.ok(snippet, id);
  return snippet;
};

test('WorkBuddy 配置使用它的 streamableHttp 类型并带 Bearer 头', () => {
  const entry = JSON.parse(pick('workbuddy').text).mcpServers.kadadesk;
  assert.equal(entry.type, 'streamableHttp'); assert.equal(entry.url, url); assert.equal(entry.headers.Authorization, `Bearer ${token}`);
});

test('Antigravity、Claude Desktop 和其他 stdio 工具走咔哒自带的本机桥：配置不含密钥、不依赖 npx mcp-remote', () => {
  for (const id of ['antigravity', 'claude-desktop', 'other']) {
    const snippet = pick(id);
    assert.ok(!snippet.text.includes(token), `${id} must not embed the key`);
    assert.ok(!snippet.text.includes('mcp-remote'), id);
    const entry = JSON.parse(snippet.text).mcpServers.kadadesk;
    assert.equal(entry.command, 'node');
    assert.deepEqual(entry.args, [stdio.script, '--open', '--data-dir', stdio.dataDir]);
  }
});

test('没有本机桥脚本时才回退到 HTTP / mcp-remote，并提示 Antigravity 的 serverUrl 风险', () => {
  const antigravity = pick('antigravity', false);
  assert.equal(JSON.parse(antigravity.text).mcpServers.kadadesk.serverUrl, url);
  assert.match(antigravity.note, /SSE/);
  assert.ok(pick('claude-desktop', false).text.includes('mcp-remote'));
});

test('Codex、Claude Code 等支持 Streamable HTTP 的工具仍直连本机地址', () => {
  const codex = pick('codex').text;
  assert.match(codex, /^\[mcp_servers\.kadadesk\]$/m);
  assert.ok(codex.includes(`url = "${url}"`));
  assert.ok(codex.includes(`http_headers = { Authorization = "Bearer ${token}" }`));
  assert.ok(pick('claude-code').text.startsWith(`claude mcp add --transport http kadadesk ${url} `));
  for (const snippet of openMcpClientSnippets({ url, token, stdio }).filter(x => x.kind === 'json')) assert.doesNotThrow(() => JSON.parse(snippet.text), snippet.id);
});

test('咔哒从 macOS 临时转移路径运行时，本机桥配置提示先拖进「应用程序」', () => {
  const translocated = { ...stdio, script: '/private/var/folders/x/AppTranslocation/ABC/d/kadadesk.app/Contents/Resources/app.asar.unpacked/desktop-build/kadadesk-mcp.cjs' };
  for (const snippet of openMcpClientSnippets({ url, token, stdio: translocated }).filter(x => ['antigravity', 'claude-desktop', 'other'].includes(x.id))) assert.match(snippet.note, /应用程序/, snippet.id);
  assert.ok(!pick('antigravity').note.includes('应用程序'));
});

test('Codex 配置不写死逐个工具的审批（交给工具标注判断），WorkBuddy 写明 WorkBuddy AI 的配置位置', () => {
  const codex = pick('codex');
  assert.ok(!codex.text.includes('approval_mode'), 'read-only annotations let codex exec run read tools; reception control still asks');
  assert.match(codex.note, /只读/);
  // Verified with WorkBuddy AI: user servers live in ~/.workbuddy-ai/mcp.json, load on restart and need trust plus enable.
  assert.match(pick('workbuddy').note, /~\/\.workbuddy-ai\/mcp\.json/); assert.match(pick('workbuddy').note, /信任/); assert.ok(!pick('workbuddy').note.includes('connectors/default'));
});

const hermesClient = { id: 'hermes-3fa9', key: 'SYNTHETIC_hermes_key_456' };
const forClient = (id: string, options: { withStdio?: boolean; withKey?: boolean; launch?: OpenMcpStdioLaunch } = {}) => {
  const { withStdio = true, withKey = true, launch = stdio } = options;
  const snippet = openMcpClientSnippets({ url, token, client: withKey ? hermesClient : { id: hermesClient.id }, ...(withStdio ? { stdio: launch } : {}) }).find(x => x.id === id);
  assert.ok(snippet, id);
  return snippet;
};
const bridgeArgs = [stdio.script, '--open', '--client', 'hermes-3fa9', '--data-dir', stdio.dataDir];

test('选了客户端且有本机桥：所有工具都经本机桥带 --client 连接，任何配置里都没有密钥', () => {
  const all = openMcpClientSnippets({ url, token, stdio, client: hermesClient });
  for (const snippet of all) {
    assert.ok(snippet.text.includes('--client'), snippet.id);
    assert.ok(!snippet.text.includes(hermesClient.key) && !snippet.text.includes(token), snippet.id);
    if (snippet.kind === 'json') assert.doesNotThrow(() => JSON.parse(snippet.text), snippet.id);
  }
  assert.deepEqual(JSON.parse(forClient('cursor').text).mcpServers.kadadesk, { command: 'node', args: bridgeArgs });
  assert.deepEqual(JSON.parse(forClient('vscode').text).servers.kadadesk, { type: 'stdio', command: 'node', args: bridgeArgs });
  assert.deepEqual(JSON.parse(forClient('workbuddy').text).mcpServers.kadadesk, { command: 'node', args: bridgeArgs });
  assert.equal(forClient('codex').text, `[mcp_servers.kadadesk]\ncommand = "node"\nargs = ${JSON.stringify(bridgeArgs)}`);
  assert.equal(forClient('claude-code').text, `claude mcp add --transport stdio kadadesk -- node ${stdio.script} --open --client hermes-3fa9 --data-dir '${stdio.dataDir}'`);
});

test('选了客户端但没有本机桥：HTTP 配置用该客户端的密钥；页面拿不到密钥时用占位符', () => {
  assert.match(forClient('codex', { withStdio: false }).text, /Bearer SYNTHETIC_hermes_key_456/);
  assert.ok(!forClient('codex', { withStdio: false }).text.includes(token));
  assert.equal(JSON.parse(forClient('workbuddy', { withStdio: false }).text).mcpServers.kadadesk.headers.Authorization, 'Bearer SYNTHETIC_hermes_key_456');
  assert.ok(forClient('cursor', { withStdio: false, withKey: false }).text.includes(CLIENT_KEY_PLACEHOLDER));
});

test('不选客户端时保持原样：默认密钥，本机桥不带 --client', () => {
  assert.deepEqual(JSON.parse(pick('antigravity').text).mcpServers.kadadesk.args, [stdio.script, '--open', '--data-dir', stdio.dataDir]);
  assert.match(pick('codex').text, new RegExp(`Bearer ${token}`));
});

test('Hermes 配置：写进 ~/.hermes/config.yaml，经本机桥连接，不含密钥；没有本机桥时用 HTTP', () => {
  const hermes = forClient('hermes');
  assert.equal(hermes.kind, 'yaml');
  assert.match(hermes.note, /~\/\.hermes\/config\.yaml/); assert.match(hermes.note, /hermes mcp test kadadesk/);
  assert.deepEqual(hermes.text.split('\n'), ['mcp_servers:', '  kadadesk:', '    command: "node"', `    args: ${JSON.stringify(bridgeArgs)}`]);
  assert.ok(!hermes.text.includes(hermesClient.key));
  const http = forClient('hermes', { withStdio: false });
  assert.match(http.text, /url: "http:\/\/127\.0\.0\.1:8811\/mcp"/); assert.match(http.text, /Authorization: "Bearer SYNTHETIC_hermes_key_456"/);
});

test('路径里有引号、反斜杠、中文或控制字符时，YAML / TOML / shell 配置仍能原样还原', () => {
  const odd = `${["/", "Users", "/"].join("")}张三/it's "q" \\ ${String.fromCharCode(0x85)}${String.fromCharCode(0x7f)}/FlowDesk`;
  const launch = { ...stdio, dataDir: odd };
  const yamlArgs = forClient('hermes', { launch }).text.split('\n')[3].replace(/^ {4}args: /, '');
  assert.ok(yamlArgs.includes('\\u0085') && yamlArgs.includes('\\u007f'));
  assert.equal(JSON.parse(yamlArgs).at(-1), odd);
  const tomlArgs = forClient('codex', { launch }).text.split('\n')[2].replace(/^args = /, '');
  assert.equal(JSON.parse(tomlArgs).at(-1), odd);
  assert.ok(forClient('claude-code', { launch }).text.endsWith(`'${odd.replaceAll("'", "'\\''")}'`));
});
