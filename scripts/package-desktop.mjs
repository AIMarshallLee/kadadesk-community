import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { packager } from '@electron/packager';
import { extractFile, listPackage } from '@electron/asar';
import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses';
import { readRuntimeLicenseManifest } from './runtime-licenses.mjs';
import { assertManualReady } from './manual.mjs';

// 每次发版同步更新使用手册：没有这个版本的更新记录（或 shared/manual-content.ts 没重新生成）就不打包。
assertManualReady();

const run = promisify(execFile);
const root = process.cwd();
const release = resolve(root, 'release');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const stage = join(release, `.staging-${stamp}`);
const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const electronCache = join(root, 'artifacts', 'electron');
const electronZip = `electron-v${metadata.devDependencies.electron}-win32-x64.zip`;
let electronZipDir;
if (await stat(join(electronCache, electronZip)).catch(() => false)) {
  const checksums = await readFile(join(electronCache, 'SHASUMS256.txt'), 'utf8');
  const expected = checksums.split(/\r?\n/).map(line => line.trim().split(/\s+/)).find(parts => parts[1]?.replace(/^\*/, '') === electronZip)?.[0];
  const actual = createHash('sha256').update(await readFile(join(electronCache, electronZip))).digest('hex');
  if (!expected || actual !== expected) throw new Error('Electron cache does not match the official SHA-256 manifest.');
  electronZipDir = electronCache;
}
await mkdir(stage, { recursive: true });
// An explicit allowlist keeps local records, credentials and build tools out of the app.
await cp(join(root, 'dist'), join(stage, 'dist'), { recursive: true });
const desktopFiles = ['main.cjs', 'preload.cjs', 'knowledge-import-worker.cjs', 'native-paste.ps1', 'usb-serial.ps1', 'usb-channel.ps1', 'window-identity.ps1', 'cu-native.ps1', 'companion-native.ps1', 'windows-ocr.ps1'];
const licenseFiles = ['react', 'react-dom', 'lucide-react', '@fontsource-variable-dm-sans', '@fontsource-variable-noto-sans-sc'].map(name => `${name}.txt`);
const runtimeLicenses = await readRuntimeLicenseManifest(root);
await mkdir(join(stage, 'desktop-build', 'licenses'), { recursive: true });
for (const name of desktopFiles) await cp(join(root, 'desktop-build', name), join(stage, 'desktop-build', name));
await cp(join(root, 'desktop-build', 'firmware'), join(stage, 'desktop-build', 'firmware'), { recursive: true });
await cp(join(root, 'desktop-build', 'pdfjs'), join(stage, 'desktop-build', 'pdfjs'), { recursive: true });
for (const name of licenseFiles) await cp(join(root, 'desktop-build', 'licenses', name), join(stage, 'desktop-build', 'licenses', name));
for (const name of runtimeLicenses.files) {
  const destination = join(stage, 'desktop-build', 'licenses', name);
  await mkdir(dirname(destination), { recursive: true });
  await cp(join(runtimeLicenses.directory, name), destination);
}
await writeFile(join(stage, 'package.json'), JSON.stringify({ name: 'kadadesk', productName: '咔哒', version: metadata.version, description: metadata.description, main: 'desktop-build/main.cjs', author: 'kadadesk' }, null, 2));
const archive = join(release, 'kadadesk-win32-x64.zip');
// A fresh output directory also works when an older portable app is still open.
const softwareRelease = join(release, 'windows-software', stamp);
await mkdir(softwareRelease, { recursive: true });
console.log('Packaging only dist, explicitly listed desktop runtime files, licenses, and the runtime manifest.');
const [built] = await packager({ dir: stage, out: softwareRelease, name: 'kadadesk', win32metadata: { ProductName: '咔哒', FileDescription: '咔哒工作台' }, icon: join(root, 'build-assets', 'icon.ico'), platform: 'win32', arch: 'x64', electronVersion: metadata.devDependencies.electron, electronZipDir, overwrite: false, asar: { unpack: '**/{*.ps1,knowledge-import-worker.cjs,*.bcmap,*.pfb,*.ttf}' }, prune: false });
const executable = join(built, 'kadadesk.exe');
await stat(executable);
// Same fuses as the Mac build (see package-macos.mjs); Windows has no ad-hoc signature to reset.
await flipFuses(join(built, 'kadadesk.exe'), { version: FuseVersion.V1, [FuseV1Options.RunAsNode]: false, [FuseV1Options.EnableCookieEncryption]: true, [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false, [FuseV1Options.EnableNodeCliInspectArguments]: false, [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true, [FuseV1Options.OnlyLoadAppFromAsar]: true });
await stat(join(built, 'resources', 'app.asar'));
const asarFile = join(built, 'resources', 'app.asar');
if (!extractFile(asarFile, join('dist', 'simulator.html')).length) throw new Error('Reply-mode simulator missing from the Windows package.');
if (listPackage(asarFile).some(file => /flowdesk-state|secrets|node_modules|\.tools/.test(file))) throw new Error('Development or private state found in package.');
if (listPackage(asarFile).some(file => /merchant-host|merchant-admin|merchant-delivery|merchant-trials|internal-trials|commerce-server|issue-license|license-signing|transfer-orders/i.test(file))) throw new Error('Administrator issuer found in customer package.');
await stat(join(built, 'resources', 'app.asar.unpacked', 'desktop-build', 'native-paste.ps1'));
// The unpacked knowledge worker reads pdf.js character maps from the real file system.
await stat(join(built, 'resources', 'app.asar.unpacked', 'desktop-build', 'pdfjs', 'cmaps', 'UniGB-UCS2-H.bcmap'));
await stat(join(built, 'resources', 'app.asar.unpacked', 'desktop-build', 'usb-serial.ps1'));
await stat(join(built, 'resources', 'app.asar.unpacked', 'desktop-build', 'cu-native.ps1'));
await stat(join(built, 'resources', 'app.asar.unpacked', 'desktop-build', 'windows-ocr.ps1'));
await stat(join(built, 'resources', 'app.asar.unpacked', 'desktop-build', 'usb-channel.ps1'));
if (!extractFile(asarFile, join('desktop-build', 'firmware', 'flowdesk_usb.uf2')).length) throw new Error('USB firmware missing from the Windows package.');
const smokeEnv = { ...process.env, FLOWDESK_SMOKE_DIR: join(release, `.smoke-${stamp}`), KADADESK_DISABLE_TRIAL: '1' };
delete smokeEnv.ELECTRON_RUN_AS_NODE;
const smoke = await run(executable, ['--smoke-test'], { windowsHide: true, env: smokeEnv, timeout: 45000, maxBuffer: 500000 });
console.log(smoke.stdout.trim());
if (!smoke.stdout.includes('FlowDesk renderer loaded successfully.')) throw new Error('Packaged application did not report a successful renderer smoke test.');
const knowledgeSmoke = await run(executable, ['--knowledge-smoke-test'], { windowsHide: true, env: smokeEnv, timeout: 45000, maxBuffer: 500000 });
console.log(knowledgeSmoke.stdout.trim());
if (!knowledgeSmoke.stdout.includes('FlowDesk knowledge import smoke passed.')) throw new Error('Packaged knowledge import smoke did not pass.');
const usbSmoke = await run(executable, ['--usb-smoke-test'], { windowsHide: true, env: smokeEnv, timeout: 120000, maxBuffer: 500000 });
console.log(usbSmoke.stdout.trim());
if (!usbSmoke.stdout.includes('FlowDesk USB replies smoke passed.')) throw new Error('Packaged USB replies smoke did not pass.');
const computerUseSmokeEnv = { ...process.env, FLOWDESK_SMOKE_DIR: join(release, `.cu-smoke-${stamp}`) };
delete computerUseSmokeEnv.ELECTRON_RUN_AS_NODE;
const computerUseSmoke = await run(executable, ['--cu-smoke-test'], { windowsHide: true, env: computerUseSmokeEnv, timeout: 60_000, maxBuffer: 500000 });
console.log(computerUseSmoke.stdout.trim());
if (!computerUseSmoke.stdout.includes('FlowDesk Computer Use SDK smoke passed.')) throw new Error('Packaged application did not report a Computer Use SDK smoke pass.');
const geminiSmoke = await run(executable, ['--gemini-smoke-test'], { windowsHide: true, env: { ...computerUseSmokeEnv, FLOWDESK_SMOKE_DIR: join(release, `.gemini-smoke-${stamp}`) }, timeout: 180000, maxBuffer: 500000 });
console.log(geminiSmoke.stdout.trim());
if (!geminiSmoke.stdout.includes('FlowDesk Gemini native smoke passed.')) throw new Error('Packaged Gemini native smoke did not pass.');
const geminiRepliesSmoke = await run(executable, ['--gemini-replies-smoke-test'], { windowsHide: true, env: { ...computerUseSmokeEnv, FLOWDESK_SMOKE_DIR: join(release, `.gemini-replies-smoke-${stamp}`) }, timeout: 240000, maxBuffer: 500000 });
console.log(geminiRepliesSmoke.stdout.trim());
if (!geminiRepliesSmoke.stdout.includes('FlowDesk Gemini persistent replies smoke passed.')) throw new Error('Packaged Gemini persistent replies smoke did not pass.');
const repliesEnv = { ...process.env, FLOWDESK_SMOKE_DIR: join(release, `.replies-smoke-${stamp}`) };
delete repliesEnv.ELECTRON_RUN_AS_NODE;
const repliesSmoke = await run(executable, ['--replies-smoke-test'], { windowsHide: true, env: repliesEnv, timeout: 120000, maxBuffer: 500000 });
console.log(repliesSmoke.stdout.trim());
if (!repliesSmoke.stdout.includes('FlowDesk desktop replies smoke passed.')) throw new Error('Packaged persistent desktop replies did not pass.');
const residentSmoke = await run(executable, ['--resident-smoke-test', `--data-profile=resident-package-${stamp.replace(/[^a-zA-Z0-9-]/g, '-')}`], { windowsHide: true, env: smokeEnv, timeout: 60000, maxBuffer: 500000 });
console.log(residentSmoke.stdout.trim());
if (!residentSmoke.stdout.includes('kadadesk resident smoke passed:')) throw new Error('Packaged tray lifecycle did not pass.');
await cp(join(root, 'docs', '使用说明.txt'), join(built, '使用说明.txt'));
for (const name of ['内测开始前请先看.html', '内测已知问题与反馈.md', '内测反馈模板.txt']) await cp(join(root, 'docs', name), join(built, name));
await cp(join(root, 'docs', '软件模式快速开始.md'), join(built, '软件模式快速开始.md'));
await cp(join(root, 'docs', '客户知识库适配指南.md'), join(built, '客户知识库适配指南.md'));
await cp(join(root, 'docs', 'WhatsApp快速开始.md'), join(built, 'WhatsApp快速开始.md'));
await cp(join(root, 'docs', '网页邮箱与智能知识库快速开始.md'), join(built, '网页邮箱与智能知识库快速开始.md'));
await cp(join(root, 'desktop-build', 'kadadesk-mcp.cjs'), join(built, 'kadadesk-mcp.cjs'));
for (const name of ['启动咔哒与Codex连接.ps1', '接入Codex.ps1']) await cp(join(root, 'scripts', name), join(built, name));
await cp(join(root, 'docs', 'Codex调用咔哒使用指南.md'), join(built, 'Codex调用咔哒使用指南.md'));
await cp(join(root, 'docs', '首次使用与配置指南.md'), join(built, '首次使用与配置指南.md'));
await cp(join(root, 'docs', '网盘远端接入与管理员配置.md'), join(built, '网盘远端接入与管理员配置.md'));
await cp(join(root, 'public', 'knowledge-template.csv'), join(built, 'knowledge-template.csv'));
await cp(join(root, 'public', 'knowledge-evaluation-template.csv'), join(built, 'knowledge-evaluation-template.csv'));
const packagedFirmware = extractFile(asarFile, join('desktop-build', 'firmware', 'flowdesk_usb.uf2'));
await writeFile(join(built, 'kadadesk-pika-RP2040.uf2'), packagedFirmware);
await writeFile(join(built, 'kadadesk-pika-RP2040.uf2.sha256'), `${createHash('sha256').update(packagedFirmware).digest('hex')}  kadadesk-pika-RP2040.uf2\n`);
await cp(join(root, 'docs', 'Pico-到货烧录与测试.md'), join(built, '皮卡-连接与测试.md'));
if (process.env.FLOWDESK_INCLUDE_INTERNAL_TEST_DOCS === '1') {
  for (const name of ['24小时测试版快速开始.md', '企业AI真实业务知识.csv', '企业AI真实业务回复流程.md', '真实聊天软件验收-20260924.md', 'Pico输入提速-20260924.md', '配置保存与中文菜单-20260924.md', 'Jev实现借鉴-20260924.md']) await cp(join(root, 'docs', name), join(built, name));
  await cp(join(root, 'artifacts', 'trial-source-manifest.json'), join(built, '测试构建记录.json'));
}
const nextArchive = join(release, `.kadadesk-${stamp}.zip`);
await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', join(root, 'scripts', 'archive.ps1'), '-Source', resolve(built), '-Destination', nextArchive], { windowsHide: true, timeout: 300000 });
if (await stat(archive).catch(() => false)) await rename(archive, `${archive}.previous-${stamp}`);
await rename(nextArchive, archive);
const info = await stat(archive);
console.log(`Windows package verified: ${archive} (${(info.size / 1024 / 1024).toFixed(1)} MB)`);
