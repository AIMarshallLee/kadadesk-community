import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { diagnosticCodes, diagnosticScopes, validDiagnosticEntry, type DiagnosticEntry, type DiagnosticScope, type DiagnosticCode } from '../shared/diagnostics';

export async function createDiagnosticLog(file: string) {
  let entries: DiagnosticEntry[]=[]; let storageOk=true; let tail=Promise.resolve();
  try { const parsed=JSON.parse(await readFile(file,'utf8')); if(Array.isArray(parsed)) entries=parsed.filter(validDiagnosticEntry).slice(-200).map(({at,scope,code})=>({at,scope,code})); }
  catch(e) { if((e as NodeJS.ErrnoException).code!=='ENOENT')storageOk=false; }
  return {
    read:()=>({entries:entries.map(e=>({...e})),storageOk}),
    async record(scope:DiagnosticScope,code:DiagnosticCode) {
      if(!diagnosticScopes.includes(scope)||!diagnosticCodes.includes(code))return;
      const now=new Date().toISOString();const last=entries.at(-1);
      if(last?.scope===scope&&last.code===code&&Date.parse(now)-Date.parse(last.at)<1000)return;
      entries.push({at:now,scope,code});entries=entries.slice(-200);
      const data=JSON.stringify(entries);tail=tail.then(async()=>{try{await mkdir(dirname(file),{recursive:true});await writeFile(file+'.tmp',data,{mode:0o600});await rename(file+'.tmp',file);storageOk=true;}catch{storageOk=false;}});await tail;
    },
  };
}
