import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

/**
 * git for 自动更新的知识来源. kadadesk uses this computer's own git and the GitHub sign-in it already has (Keychain,
 * Git Credential Manager, the GitHub CLI): it never asks for, stores or passes a token or password. Every call is
 * execFile with an argument array (never a shell string), runs with prompts disabled, and is bounded in time.
 */
export interface GitRun { stdout: string; stderr: string }
export type GitRunner = (file: string, args: string[], options: { cwd?: string; env: NodeJS.ProcessEnv; timeoutMs: number; signal?: AbortSignal; maxBuffer?: number }) => Promise<GitRun>;
export interface GitTreeEntry { path: string; size: number; hash: string }

export type GitProblemKind = 'missing' | 'auth' | 'network' | 'failed';
export class GitProblem extends Error {
  constructor(public kind: GitProblemKind, message: string) { super(message); this.name = 'GitProblem'; }
}

export const GIT_MISSING = '这台电脑还没装 git，读不了私有仓库。Mac：打开「终端」运行 xcode-select --install，按提示装好开发者工具；Windows：安装 Git for Windows。也可以在 GitHub 页面点「Code」→「Download ZIP」，下载后拖进上面的框。';
export const GIT_NO_ACCESS = '这台电脑还没登录 GitHub，或登录的账号看不到这个仓库。可以装好 GitHub Desktop 并用能看到这个仓库的账号登录，把仓库克隆到电脑上，再点「添加本地文件夹」选那个文件夹；或者在 GitHub 页面点「Code」→「Download ZIP」，下载后拖进上面的框。咔哒不会问你要密码或令牌。';
export const GIT_OFFLINE = '连不上 GitHub（可能是网络问题），下次不忙的时候会再试。急用的话检查网络后点「立即更新」。';

/** Never prompt (terminal, GUI credential manager, askpass), never download LFS objects, plain English output to classify. */
export function gitEnv(base: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '', GIT_LFS_SKIP_SMUDGE: '1', LC_ALL: 'C', LANG: 'C' };
  delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.GIT_INDEX_FILE;
  // Apps opened from the Finder get a minimal PATH: a credential helper such as the GitHub CLI lives in Homebrew's folders.
  if (platform === 'darwin') { const path = (env.PATH ?? '').split(delimiter).filter(Boolean); for (const extra of ['/opt/homebrew/bin', '/usr/local/bin']) if (!path.includes(extra)) path.push(extra); env.PATH = path.join(delimiter); }
  return env;
}
/** Settings for every call: no symlinks in a checkout, HTTPS only, no interactive credential manager. */
export const GIT_SAFE_CONFIG = ['-c', 'core.symlinks=false', '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'credential.interactive=never', '-c', 'core.fsmonitor=false', '-c', 'advice.detachedHead=false'];

export const execFileRunner: GitRunner = (file, args, options) => new Promise((resolve, reject) => {
  execFile(file, args, { cwd: options.cwd, env: options.env, timeout: options.timeoutMs, signal: options.signal, maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024, windowsHide: true, encoding: 'utf8' }, (error, stdout, stderr) => {
    if (error) { Object.assign(error, { stdout, stderr }); reject(error); } else resolve({ stdout, stderr });
  });
});

/** Plain-Chinese reason for a failed git call; the raw output is never shown or logged. */
export function classifyGitError(error: unknown): GitProblem {
  if (error instanceof GitProblem) return error;
  const e = error as NodeJS.ErrnoException & { stderr?: string; killed?: boolean; signal?: string };
  if (e?.code === 'ENOENT') return new GitProblem('missing', GIT_MISSING);
  if (e?.name === 'AbortError' || e?.code === 'ABORT_ERR') return new GitProblem('failed', '已停下。');
  const text = `${e?.stderr ?? ''}\n${e?.message ?? ''}`;
  if (/terminal prompts disabled|could not read (?:username|password)|authentication failed|invalid username or password|repository not found|permission denied|requested url returned error: 40[134]|access denied|not authorized|credential/i.test(text)) return new GitProblem('auth', GIT_NO_ACCESS);
  if (e?.killed || e?.signal === 'SIGTERM' || /could not resolve host|failed to connect|connection (?:timed out|refused|reset)|operation timed out|unable to access|network is unreachable|ssl|tls|early eof|remote end hung up|http\/2 stream/i.test(text)) return new GitProblem('network', GIT_OFFLINE);
  return new GitProblem('failed', '用 git 读取仓库没成功，下次不忙的时候会再试；一直不行的话，在 GitHub 页面下载 ZIP 拖进来。');
}

const exists = async (path: string) => { try { await access(path); return true; } catch { return false; } };

/** Where git may be on this computer, in order. On a Mac /usr/bin/git is only used once the developer tools are there. */
export async function gitCandidates(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  if (platform === 'win32') {
    const programs = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs')].filter((p): p is string => !!p);
    return ['git', ...programs.map(p => join(p, 'Git', 'cmd', 'git.exe'))];
  }
  if (platform === 'darwin') return ['/opt/homebrew/bin/git', '/usr/local/bin/git', '/usr/bin/git', '/Applications/GitHub Desktop.app/Contents/Resources/app/git/bin/git'];
  return ['git', '/usr/bin/git', '/usr/local/bin/git'];
}

export interface GitClient {
  /** The git that works here, or undefined (missing). Never opens an install dialog. */
  locate(): Promise<string | undefined>;
  /** The commit the remote's default branch points to: the light check, nothing is downloaded. */
  remoteHead(url: string, signal?: AbortSignal): Promise<string>;
  /** A shallow clone (first time) or a shallow fetch + reset (later) of `url` into `dir`; returns the commit. */
  update(url: string, dir: string, signal?: AbortSignal): Promise<string>;
  /** Every file of the checkout with its size and git blob hash (no file is read). Symlinks and submodules are left out. */
  tree(dir: string, signal?: AbortSignal): Promise<GitTreeEntry[]>;
}

export function createGitClient(options: { run?: GitRunner; platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; candidates?: string[]; exists?: (path: string) => Promise<boolean>; timeoutMs?: number } = {}): GitClient {
  const run = options.run ?? execFileRunner, platform = options.platform ?? process.platform, env = gitEnv(options.env ?? process.env, platform);
  const has = options.exists ?? exists;
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  let found: { at: number; file?: string } | undefined;
  async function locate() {
    if (found && Date.now() - found.at < 10 * 60_000) return found.file;
    let file: string | undefined;
    for (const candidate of options.candidates ?? await gitCandidates(platform, options.env ?? process.env)) {
      if (candidate.includes('/') || candidate.includes('\\')) { if (!await has(candidate)) continue; }
      // macOS ships /usr/bin/git as a stub that pops up an installer: ask xcode-select first, which never does.
      if (platform === 'darwin' && candidate === '/usr/bin/git') { try { await run('/usr/bin/xcode-select', ['-p'], { env, timeoutMs: 10_000 }); } catch { continue; } }
      try { await run(candidate, ['--version'], { env, timeoutMs: 15_000 }); file = candidate; break; } catch { /* next */ }
    }
    found = { at: Date.now(), file };
    return file;
  }
  async function git(args: string[], o: { cwd?: string; signal?: AbortSignal; timeoutMs?: number; maxBuffer?: number } = {}) {
    const file = await locate();
    if (!file) throw new GitProblem('missing', GIT_MISSING);
    try { return await run(file, [...GIT_SAFE_CONFIG, ...args], { cwd: o.cwd, env, timeoutMs: o.timeoutMs ?? timeoutMs, signal: o.signal, maxBuffer: o.maxBuffer }); }
    catch (error) { throw classifyGitError(error); }
  }
  const sha = (text: string) => { const m = /^([0-9a-f]{40}|[0-9a-f]{64})\b/m.exec(text.trim()); if (!m) throw new GitProblem('failed', '读取仓库版本没成功，下次再试。'); return m[1]!; };
  return {
    locate,
    async remoteHead(url, signal) {
      const out = await git(['ls-remote', '--', url, 'HEAD'], { signal, timeoutMs: 60_000 });
      if (!out.stdout.trim()) throw new GitProblem('failed', '这个仓库还是空的，先往里面放资料再更新。');
      return sha(out.stdout);
    },
    async update(url, dir, signal) {
      if (!await has(join(dir, '.git'))) await git(['clone', '--depth', '1', '--no-tags', '--single-branch', '--no-recurse-submodules', '--', url, dir], { signal });
      else {
        await git(['-C', dir, 'fetch', '--depth', '1', '--no-tags', '--no-recurse-submodules', '--', url, 'HEAD'], { signal });
        await git(['-C', dir, 'reset', '--hard', '--quiet', 'FETCH_HEAD'], { signal, timeoutMs: 120_000 });
      }
      return sha((await git(['-C', dir, 'rev-parse', 'HEAD'], { signal, timeoutMs: 30_000 })).stdout);
    },
    async tree(dir, signal) {
      const out = await git(['-C', dir, 'ls-tree', '-r', '-l', '-z', 'HEAD'], { signal, timeoutMs: 60_000, maxBuffer: 64 * 1024 * 1024 });
      return parseLsTree(out.stdout);
    },
  };
}

/** `git ls-tree -r -l -z`: "<mode> <type> <hash> <size>\t<path>\0". Only regular files (100644 / 100755). */
export function parseLsTree(output: string): GitTreeEntry[] {
  const entries: GitTreeEntry[] = [];
  for (const record of output.split('\0')) {
    const m = /^(\d{6}) (\w+) ([0-9a-f]{40,64}) +(\d+|-)\t([\s\S]+)$/.exec(record);
    if (!m || m[2] !== 'blob' || (m[1] !== '100644' && m[1] !== '100755')) continue;
    entries.push({ path: m[5]!, size: Number(m[4]), hash: m[3]! });
  }
  return entries;
}
