/** Connection snippets shown on the 开放 page. Every `text` is valid as-is for its kind (shell / JSON / TOML / YAML);
 *  guidance lives in `note`.
 *  - Default key: Streamable-HTTP clients connect directly with the key; stdio-only clients run the bundled bridge
 *    (`kadadesk-mcp.cjs --open`), which reads the key from kadadesk's data directory.
 *  - Named client with the bridge available: every snippet runs the bridge with `--client <id>`, so no config holds a
 *    key. Without the bridge, HTTP snippets carry that client's key, or a placeholder when the page has no key. */
export interface OpenMcpStdioLaunch { command: string; script: string; dataDir: string }
export interface OpenMcpSnippet { id: string; name: string; note: string; kind: 'shell' | 'json' | 'toml' | 'yaml'; text: string }

export const CLIENT_KEY_PLACEHOLDER = '<在咔哒「开放」页复制这个客户端的密钥>';
const NODE_NOTE = '需要 Node.js 20 或更高版本；若提示找不到 node，把 "node" 换成终端里 which node（Windows：where node）显示的完整路径。这段配置不含密钥，由咔哒在本机读取。';
// macOS runs a quarantined app that was not moved to /Applications from a random temporary path that changes on relaunch.
const TRANSLOCATED_NOTE = '注意：咔哒当前从 macOS 的临时位置运行，下面的路径下次启动就会失效；请先把咔哒拖进「应用程序」并重新打开，再复制这段。';
const WORKBUDDY_NOTE = 'WorkBuddy AI：写入 ~/.workbuddy-ai/mcp.json（WorkBuddy：~/.workbuddy/mcp.json），然后完全退出并重新打开 WorkBuddy，在 MCP 设置里对 kadadesk 点信任并启用，再新开一个对话。';
const CODEX_NOTE = '~/.codex/config.toml 追加。咔哒的工具带只读标注：codex exec 无人值守时会直接运行只读工具，暂停 / 恢复接待仍会先请求确认。';

// JSON strings are valid YAML and TOML basic strings once DEL and the C1 controls are escaped too (JSON leaves them raw).
const quoted = (value: unknown) => [...JSON.stringify(value)].map(char => { const code = char.charCodeAt(0); return code >= 0x7f && code <= 0x9f ? `\\u${code.toString(16).padStart(4, '0')}` : char; }).join('');
const shellQuote = (value: string) => /^[A-Za-z0-9_./:=@-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;

export function openMcpClientSnippets({ url, token, stdio, client }: { url: string; token: string; stdio?: OpenMcpStdioLaunch; client?: { id: string; key?: string } }): OpenMcpSnippet[] {
  const bearer = `Bearer ${client ? client.key ?? CLIENT_KEY_PLACEHOLDER : token}`;
  const headers = { Authorization: bearer };
  const servers = (entry: Record<string, unknown>) => JSON.stringify({ mcpServers: { kadadesk: entry } }, null, 2);
  const local = stdio && { command: stdio.command, args: [stdio.script, '--open', ...(client ? ['--client', client.id] : []), '--data-dir', stdio.dataDir] };
  const nodeNote = stdio?.script.includes('/AppTranslocation/') ? `${TRANSLOCATED_NOTE}${NODE_NOTE}` : NODE_NOTE;
  const hermes = local
    ? `mcp_servers:\n  kadadesk:\n    command: ${quoted(local.command)}\n    args: ${quoted(local.args)}`
    : `mcp_servers:\n  kadadesk:\n    url: ${quoted(url)}\n    headers:\n      Authorization: ${quoted(bearer)}`;
  const hermesSnippet: OpenMcpSnippet = { id: 'hermes', name: 'Hermes', note: `写进 ~/.hermes/config.yaml 的 mcp_servers 下（已有 mcp_servers 时只加 kadadesk 这一段），保存后执行 hermes mcp test kadadesk 检查。${local ? nodeNote : ''}`, kind: 'yaml', text: hermes };
  if (client && local) {
    return [
      hermesSnippet,
      { id: 'claude-code', name: 'Claude Code', note: `终端执行一行。${nodeNote}`, kind: 'shell', text: `claude mcp add --transport stdio kadadesk -- ${[local.command, ...local.args].map(shellQuote).join(' ')}` },
      { id: 'codex', name: 'Codex CLI', note: `${CODEX_NOTE}${nodeNote}`, kind: 'toml', text: `[mcp_servers.kadadesk]\ncommand = ${quoted(local.command)}\nargs = ${quoted(local.args)}` },
      { id: 'cursor', name: 'Cursor', note: `.cursor/mcp.json 或全局 mcp.json。${nodeNote}`, kind: 'json', text: servers(local) },
      { id: 'antigravity', name: 'Antigravity / Windsurf', note: `Antigravity：~/.gemini/config/mcp_config.json；Windsurf：~/.codeium/windsurf/mcp_config.json。${nodeNote}`, kind: 'json', text: servers(local) },
      { id: 'gemini-cli', name: 'Gemini CLI', note: `~/.gemini/settings.json。${nodeNote}`, kind: 'json', text: servers(local) },
      { id: 'vscode', name: 'VS Code Copilot', note: `.vscode/mcp.json。${nodeNote}`, kind: 'json', text: JSON.stringify({ servers: { kadadesk: { type: 'stdio', ...local } } }, null, 2) },
      { id: 'claude-desktop', name: 'Claude Desktop', note: `claude_desktop_config.json。${nodeNote}`, kind: 'json', text: servers(local) },
      { id: 'workbuddy', name: 'WorkBuddy', note: `${WORKBUDDY_NOTE}${nodeNote}`, kind: 'json', text: servers(local) },
      { id: 'other', name: '其他（通义灵码 / Trae / Cline 等）', note: `支持命令行（stdio）的工具用这段。只支持 HTTP 的工具：在 MCP 设置里填 ${url}，Authorization 头用「客户端」里「复制密钥」得到的 Bearer 密钥。${nodeNote}`, kind: 'json', text: servers(local) },
    ];
  }
  const remote = { command: 'npx', args: ['-y', 'mcp-remote', url, '--header', `Authorization: ${bearer}`] };
  return [
    hermesSnippet,
    { id: 'claude-code', name: 'Claude Code', note: '终端执行一行', kind: 'shell', text: `claude mcp add --transport http kadadesk ${url} --header "Authorization: ${bearer}"` },
    { id: 'codex', name: 'Codex CLI', note: CODEX_NOTE, kind: 'toml', text: `[mcp_servers.kadadesk]\nurl = ${quoted(url)}\nhttp_headers = { Authorization = ${quoted(bearer)} }` },
    { id: 'cursor', name: 'Cursor', note: '.cursor/mcp.json 或全局 mcp.json', kind: 'json', text: servers({ url, headers }) },
    local
      ? { id: 'antigravity', name: 'Antigravity / Windsurf', note: `Antigravity：~/.gemini/config/mcp_config.json；Windsurf：~/.codeium/windsurf/mcp_config.json。经咔哒自带的本机桥连接。${nodeNote}`, kind: 'json', text: servers(local) }
      : { id: 'antigravity', name: 'Antigravity / Windsurf', note: 'Antigravity：~/.gemini/config/mcp_config.json。注意：Antigravity 的文档把 serverUrl 描述为 SSE，而咔哒只提供 Streamable HTTP，可能连不上；请改用带本机桥的咔哒版本。', kind: 'json', text: servers({ serverUrl: url, headers }) },
    { id: 'gemini-cli', name: 'Gemini CLI', note: '~/.gemini/settings.json', kind: 'json', text: servers({ httpUrl: url, headers }) },
    { id: 'vscode', name: 'VS Code Copilot', note: '.vscode/mcp.json', kind: 'json', text: JSON.stringify({ servers: { kadadesk: { type: 'http', url, headers } } }, null, 2) },
    { id: 'claude-desktop', name: 'Claude Desktop', note: local ? `claude_desktop_config.json。${nodeNote}` : 'claude_desktop_config.json（需要 Node.js，经 mcp-remote 桥接）', kind: 'json', text: servers(local ?? remote) },
    { id: 'workbuddy', name: 'WorkBuddy', note: WORKBUDDY_NOTE, kind: 'json', text: servers({ type: 'streamableHttp', url, headers, timeout: 60000 }) },
    { id: 'other', name: '其他（通义灵码 / Trae / Cline 等）', note: `支持 HTTP（Streamable）的工具：在 MCP 设置里填 ${url} 和 Authorization 头（同 Cursor 那段）。只支持命令行（stdio）的工具用下面这段。${local ? nodeNote : '需要 Node.js，经 mcp-remote 桥接。'}`, kind: 'json', text: servers(local ?? remote) },
  ];
}
