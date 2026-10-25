import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { mkdir, copyFile, cp } from 'node:fs/promises';
import { computerUseRuntimeRoots, copyRuntimeLicenses } from './runtime-licenses.mjs';

await mkdir('desktop-build', { recursive: true });
await Promise.all([
  build({ entryPoints: ['desktop/kadadesk-mcp-cli.ts'], outfile: 'desktop-build/kadadesk-mcp.cjs', bundle: true, platform: 'node', target: 'node20', format: 'cjs' }),
  build({
    entryPoints: ['desktop/main.ts'],
    outfile: 'desktop-build/main.cjs',
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: ['electron', '@aws-sdk/client-s3'],
    define: {
      'process.env.FLOWDESK_DEV_MODE': '"0"',
      'import.meta.url': '""'
    }
  }),
  build({ entryPoints: ['server/knowledge-import-worker.ts'], outfile: 'desktop-build/knowledge-import-worker.cjs', bundle: true, platform: 'node', target: 'node20', format: 'cjs', external: ['@aws-sdk/client-s3'] }),
  build({ entryPoints: ['desktop/preload.ts'], outfile: 'desktop-build/preload.cjs', bundle: true, platform: 'node', target: 'node20', format: 'cjs', external: ['electron'] })
]);

// Community packages must never carry merchant host, license keys or proprietary markers.
const customerMain = readFileSync('desktop-build/main.cjs', 'utf8');
for (const marker of ['kadadesk-merchant-host-v1', 'transfer-orders.sqlite', 'internal_trial_grants', 'operator_confirmed_transfer', 'alipay.trade.page.pay', 'example.com']) {
  if (customerMain.includes(marker)) throw new Error('Proprietary marker entered the desktop bundle: ' + marker);
}

// pdf.js character maps and standard fonts: text PDFs with non-embedded Chinese fonts read as blank without them.
for (const name of ['cmaps', 'standard_fonts']) {
  await cp(`node_modules/pdfjs-dist/${name}`, `desktop-build/pdfjs/${name}`, { recursive: true });
}

await mkdir('desktop-build/licenses', { recursive: true });
for (const name of ['react', 'react-dom', 'lucide-react', '@fontsource-variable/dm-sans', '@fontsource-variable/noto-sans-sc']) {
  await copyFile(`node_modules/${name}/LICENSE`, `desktop-build/licenses/${name.replaceAll('/', '-')}.txt`);
}

await copyRuntimeLicenses({ roots: computerUseRuntimeRoots });
