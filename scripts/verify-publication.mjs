#!/usr/bin/env node
/**
 * Public-repository fail-closed checks.
 * Restricts file types and known private-origin directories, detects common
 * secrets, and guards tracked text. Human license/data review remains mandatory.
 * This is a PUBLIC checkout scanner; the PRIVATE export allowlist runs separately.
 */
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const tracked=execFileSync('git',['ls-files','-z'],{cwd:root}).toString('utf8').split('\0').filter(Boolean);
const badName=[
 /(^|\/)\.env(?:\.|$)/i,
 /(^|\/)(?:secrets?|credentials?|customer-data|runtime-profiles?|captured-chats?|recordings)(\/|$)/i,
 /(^|\/)(?:firmware|merchant-keys|private-builds)(\/|$)/i,
 /\.(?:pem|p12|pfx|kdbx|sqlite|db|exe|dll|dylib|so|7z|mp4|mov)$/i,
 /^server\/(?:commerce|merchant-|owner-license-issuer)/i,
 /^desktop\/(?:replies-ipc|hardware-|ch9329-|.*native)/i,
];

// Reviewed binary assets permitted in the public repository
const reviewedBinaries = new Set([
  'public/kada-mascot.png',
  'src/assets/kada-mascot.png',
  ...Array.from({length: 10}, (_, i) => `public/mascots/kada-${String(i+1).padStart(2, '0')}.png`)
]);

// Build regex patterns using split parts to prevent self-matching in scanner source
const patterns=[
 ['sec-private-key',/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
 ['sec-github-token',/\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
 ['sec-github-pat',/\bgithub_pat_[A-Za-z0-9_]{30,}\b/],
 ['sec-openai-secret',/\bsk-(?:proj-)?[A-Za-z0-9_-]{25,}\b/],
 ['sec-aws-secret',/\bAKIA[0-9A-Z]{16}\b/],
 ['sec-slack-secret',/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
 ['sec-jwt',/\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\b/],
 ['sec-connection-credentials',/(?:postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?):\/\/[^@\s]+@/i],
 ['sec-cn-mobile-number',/(?<!\d)1[3-9]\d{9}(?!\d)/],
 ['redline-01', new RegExp(['大', '帅'].join('') + '|' + ['帅', '厂', '长'].join(''))],
 ['redline-02', new RegExp(['hu', 'ai', 'bei'].join(''), 'i')],
 ['redline-03', new RegExp(['jun', 'shi', 'da', 'shuai'].join(''), 'i')],
 ['redline-04', new RegExp(['欣', '光'].join(''))],
 ['redline-05', new RegExp(['MOVE', 'SPEED'].join(''), 'i')],
 ['redline-06', new RegExp(['host', '-c-'].join(''))],
 ['redline-07', new RegExp(['da', 'sean'].join(''), 'i')],
 ['redline-08', new RegExp(['da', 'sean', 'lee'].join(''), 'i')],
 ['redline-09', new RegExp(['Marshall', 'PD'].join(''), 'i')],
 ['redline-10', new RegExp(['初', '夏'].join(''))],
 ['redline-11', new RegExp(['Marshall', '\\s+', 'Lee'].join(''), 'i')],
 ['redline-12', new RegExp(['R765', 'X25892'].join(''))],
 ['redline-13', new RegExp(['/Us', 'ers/'].join(''))],
 ['redline-14', new RegExp(['/Vol', 'umes/'].join(''))],
 ['redline-15', new RegExp(['kunlun', 'growth', '\\.cn'].join(''), 'i')],
 ['redline-16', new RegExp(['微', '信'].join(''))],
];

const issues=[];
for (const f of tracked){
 if(f.includes('\\')||f.split('/').some(x=>x==='..'))issues.push({file:f,rule:'path-traversal'});
 if(badName.some(r=>r.test(f)))issues.push({file:f,rule:'forbidden-path'});
 const file=await readFile(path.join(root,f));
 if(file.length>1_000_000)issues.push({file:f,rule:'large-tracked-file'});
 if(file.includes(0)){
   if(!reviewedBinaries.has(f)){
     issues.push({file:f,rule:'binary-not-reviewed'});
   }
   continue;
 }
 if(file.length>1_000_000)continue;
 const s=file.toString('utf8');
 if(!Buffer.from(s,'utf8').equals(file))issues.push({file:f,rule:'non-utf8'});
 for(const [label,rx] of patterns)if(rx.test(s))issues.push({file:f,rule:label});
}

const summary={trackedFiles:tracked.length,issues:issues.length,failedFiles:[...new Set(issues.map(x=>x.file))].length};
process.stdout.write(JSON.stringify(summary)+'\n');
if(issues.length){
 for(const x of issues)process.stderr.write('BLOCK '+x.rule+' in '+x.file+'\n');
 process.stderr.write('STOP: never bypass security guard to force-publish; review and sanitize candidate content.\n');
 process.exit(1);
}
process.stdout.write('PASS: tracked public source has no matched high-risk paths / secret patterns. Manual license and platform review still required.\n');
