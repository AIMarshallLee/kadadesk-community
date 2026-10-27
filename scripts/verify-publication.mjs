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
const trackedEntries=execFileSync('git',['ls-files','--stage','-z'],{cwd:root}).toString('utf8').split('\0').filter(Boolean).map(line=>{
 const m=/^(\d{6}) ([0-9a-f]{40}) (\d)\t(.+)$/.exec(line);
 if(!m)throw new Error('Unexpected Git index entry');
 return {mode:m[1],sha:m[2],stage:m[3],file:m[4]};
});
const tracked=trackedEntries.map(e=>e.file);
// A Git submodule contains upstream code not scanned by this publication guard.
// Only the explicitly reviewed upstream URL, path, and pinned SHA are permitted.
const approvedSubmodules=new Map([['vendor/anthropic-knowledge-work-plugins','d9d8e1331e45e87e36792040e840da4fc6260b4b']]);
const expectedGitmodules='[submodule "anthropic-knowledge-work-plugins"]\n\tpath = vendor/anthropic-knowledge-work-plugins\n\turl = https://github.com/anthropics/knowledge-work-plugins.git\n';
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
const gitlinks=trackedEntries.filter(e=>e.mode==='160000');
if(gitlinks.length!==1 || gitlinks.some(e=>e.stage!=='0'||approvedSubmodules.get(e.file)!==e.sha))
 issues.push({file:'.gitmodules',rule:'unapproved-submodule'});
if(!tracked.includes('.gitmodules'))issues.push({file:'.gitmodules',rule:'missing-gitmodules'});
else if((await readFile(path.join(root,'.gitmodules'),'utf8'))!==expectedGitmodules)
 issues.push({file:'.gitmodules',rule:'submodule-config-drift'});
for (const entry of trackedEntries){
 const f=entry.file;
 if(entry.mode==='160000')continue; // Gitlink only: upstream files NOT scanned.
 if(entry.mode!=='100644'&&entry.mode!=='100755')issues.push({file:f,rule:'unreviewed-mode'});
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
const summary={trackedFiles:tracked.length,externalSubmodules:gitlinks.length,upstreamContentScanned:false,issues:issues.length,failedFiles:[...new Set(issues.map(x=>x.file))].length};
process.stdout.write(JSON.stringify(summary)+'\n');
if(issues.length){
 for(const x of issues)process.stderr.write('BLOCK '+x.rule+' in '+x.file+'\n');
 process.stderr.write('STOP: never bypass security guard to force-publish; review and sanitize candidate content.\n');
 process.exit(1);
}
process.stdout.write('PASS: tracked public source has no matched high-risk paths / secret patterns. Pinned submodule metadata validated only; upstream content NOT scanned. Manual license, code, and platform review still required.\n');
