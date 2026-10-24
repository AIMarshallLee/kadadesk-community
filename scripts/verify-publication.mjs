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
const patterns=[
 ['private-key',/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
 ['github-token',/\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
 ['github-pat',/\bgithub_pat_[A-Za-z0-9_]{30,}\b/],
 ['openai-secret',/\bsk-(?:proj-)?[A-Za-z0-9_-]{25,}\b/],
 ['aws-secret',/\bAKIA[0-9A-Z]{16}\b/],
 ['slack-secret',/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
 ['jwt',/\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\b/],
 ['connection-credentials',/(?:postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?):\/\/[^@\s]+@/i],
 ['cn-mobile-number',/(?<!\d)1[3-9]\d{9}(?!\d)/],
];
const issues=[];
for (const f of tracked){
 if(f.includes('\\')||f.split('/').some(x=>x==='..'))issues.push({file:f,rule:'path-traversal'});
 if(badName.some(r=>r.test(f)))issues.push({file:f,rule:'forbidden-path'});
 const file=await readFile(path.join(root,f));
 if(file.length>1_000_000)issues.push({file:f,rule:'large-tracked-file'});
 if(file.includes(0))issues.push({file:f,rule:'binary-not-reviewed'});
 if(file.length>1_000_000||file.includes(0))continue;
 const s=file.toString('utf8');
 if(!Buffer.from(s,'utf8').equals(file))issues.push({file:f,rule:'non-utf8'});
 // Any match requires manual remediation; do not print matched secret content.
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
