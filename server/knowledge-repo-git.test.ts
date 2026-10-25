import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyGitError, createGitClient, gitEnv, parseLsTree, GIT_MISSING, GIT_NO_ACCESS, GIT_OFFLINE, type GitRunner } from './knowledge-repo-git';

type Call = { file: string; args: string[]; env: NodeJS.ProcessEnv; cwd?: string };
/** A recording runner: never starts a process. `answer` decides each call's output or failure. */
function fakeRunner(answer: (call: Call) => { stdout?: string; error?: Partial<NodeJS.ErrnoException> & { stderr?: string } }) {
  const calls: Call[] = [];
  const run: GitRunner = async (file, args, options) => {
    const call = { file, args, env: options.env, cwd: options.cwd }; calls.push(call);
    const out = answer(call);
    if (out.error) throw Object.assign(new Error(out.error.message ?? 'failed'), out.error);
    return { stdout: out.stdout ?? '', stderr: '' };
  };
  return { run, calls };
}
const SHA = 'a'.repeat(40);

test('git runs with argument arrays, prompts off and safe settings; clone first, then fetch + reset', async () => {
  let cloned = false;
  const { run, calls } = fakeRunner(c => {
    if (c.args.includes('--version')) return { stdout: 'git version 2.39.5' };
    if (c.args.includes('ls-remote')) return { stdout: `${SHA}\tHEAD\n` };
    if (c.args.includes('rev-parse')) return { stdout: SHA + '\n' };
    if (c.args.includes('clone')) { cloned = true; return {}; }
    return {};
  });
  const git = createGitClient({ run, platform: 'linux', env: { PATH: '/usr/bin', GIT_DIR: '/elsewhere' }, candidates: ['git'], exists: async p => p.endsWith('.git') ? cloned : true });
  assert.equal(await git.remoteHead('https://github.com/acme/handbook'), SHA);
  assert.equal(await git.update('https://github.com/acme/handbook', '/data/repo'), SHA);
  assert.equal(await git.update('https://github.com/acme/handbook', '/data/repo'), SHA);
  for (const c of calls) {
    assert.ok(Array.isArray(c.args) && c.args.every(a => typeof a === 'string'), 'argument array');
    assert.equal(c.file, 'git', 'no shell');
    assert.equal(c.env.GIT_TERMINAL_PROMPT, '0'); assert.equal(c.env.GCM_INTERACTIVE, 'never'); assert.equal(c.env.GIT_ASKPASS, ''); assert.equal(c.env.GIT_LFS_SKIP_SMUDGE, '1');
    assert.equal(c.env.GIT_DIR, undefined, 'a GIT_DIR of the parent never redirects kadadesk');
  }
  const ops = calls.filter(c => !c.args.includes('--version'));
  for (const c of ops) { assert.deepEqual(c.args.slice(0, 2), ['-c', 'core.symlinks=false']); assert.ok(c.args.includes('credential.interactive=never')); assert.ok(c.args.includes('protocol.allow=never')); }
  const lsRemote = ops.find(c => c.args.includes('ls-remote'))!; assert.deepEqual(lsRemote.args.slice(-3), ['--', 'https://github.com/acme/handbook', 'HEAD']);
  const clone = ops.find(c => c.args.includes('clone'))!; assert.deepEqual(clone.args.slice(-3), ['--', 'https://github.com/acme/handbook', '/data/repo']); assert.ok(clone.args.includes('--depth') && clone.args.includes('--no-recurse-submodules'));
  const fetch = ops.find(c => c.args.includes('fetch'))!; assert.deepEqual(fetch.args.slice(-3), ['--', 'https://github.com/acme/handbook', 'HEAD']);
  assert.ok(ops.some(c => c.args.includes('reset') && c.args.includes('FETCH_HEAD')));
  assert.equal(ops.filter(c => c.args.includes('clone')).length, 1);
});

test('missing git: a plain explanation, and on a Mac the stub /usr/bin/git is never started without the developer tools', async () => {
  const { run, calls } = fakeRunner(c => c.file === '/usr/bin/xcode-select' ? { error: { code: 'ENOENT' } } : { stdout: 'git version 2.39.5' });
  const git = createGitClient({ run, platform: 'darwin', env: {}, exists: async p => p === '/usr/bin/git' });
  assert.equal(await git.locate(), undefined);
  assert.ok(!calls.some(c => c.file === '/usr/bin/git'), 'the installer stub is not started');
  await assert.rejects(git.remoteHead('https://github.com/acme/handbook'), (e: Error) => e.message === GIT_MISSING);
  const withTools = fakeRunner(() => ({ stdout: SHA + '\tHEAD' }));
  const ok = createGitClient({ run: withTools.run, platform: 'darwin', env: {}, exists: async p => p === '/usr/bin/git' });
  assert.equal(await ok.locate(), '/usr/bin/git');
  assert.ok(gitEnv({ PATH: '/usr/bin:/bin' }, 'darwin').PATH!.includes('/opt/homebrew/bin'), 'a GitHub CLI credential helper in Homebrew is found');
});

test('no access and network problems become plain Chinese; nothing of git output is shown', () => {
  assert.equal(classifyGitError({ stderr: "fatal: could not read Username for 'https://github.com': terminal prompts disabled" }).message, GIT_NO_ACCESS);
  assert.equal(classifyGitError({ stderr: 'remote: Repository not found.\nfatal: repository not found' }).kind, 'auth');
  assert.equal(classifyGitError({ stderr: 'fatal: unable to access: Could not resolve host: github.com' }).message, GIT_OFFLINE);
  assert.equal(classifyGitError({ killed: true, signal: 'SIGTERM' }).kind, 'network');
  assert.equal(classifyGitError({ code: 'ENOENT' }).message, GIT_MISSING);
  const dummyGhp = ['g', 'h', 'p', '_abcdefghijklmnopqrstuvwxyz'].join('');
  const ghpPattern = new RegExp(['g', 'h', 'p', '_'].join(''));
  assert.doesNotMatch(classifyGitError({ stderr: `weird token ${dummyGhp}` }).message, ghpPattern);
});

test('ls-tree: regular files with size and blob hash; symlinks and submodules left out', () => {
  const h = (c: string) => c.repeat(40);
  const out = [`100644 blob ${h('1')}     120\t销售/价格.md`, `100755 blob ${h('2')}      5\trun.sh`, `120000 blob ${h('3')}     10\tlink.md`, `160000 commit ${h('4')}       -\tsub`, ''].join('\0');
  assert.deepEqual(parseLsTree(out), [{ path: '销售/价格.md', size: 120, hash: h('1') }, { path: 'run.sh', size: 5, hash: h('2') }]);
});
