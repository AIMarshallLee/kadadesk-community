export interface KnowledgeSource {
  id:string; kind:'feishu'|'notion'|'folder'|import('./cloud-drives').DriveKind; name:string; location:string;
  status:'idle'|'reading'|'ready'|'error'; detail:string; updatedAt?:string;
  signature?:string; knowledgeIds:string[];
}
export interface KnowledgeSourceView { sources:KnowledgeSource[]; busy:boolean; current?:string; stopRequested:boolean }
