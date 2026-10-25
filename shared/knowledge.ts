import type { Knowledge, Scenario } from './types';

export const KNOWLEDGE_IMPORT_LIMITS = { files: 5, fileBytes: 8 * 1024 * 1024, base64Characters: 12 * 1024 * 1024, rows: 300, previewRows: 3000, extractedCharacters: 500000 };
export type KnowledgeDraft = Pick<Knowledge, 'title' | 'content' | 'tags' | 'question' | 'aliases' | 'scenario' | 'source' | 'sourceLocator'>;
export interface KnowledgeImportFile { name: string; size: number; base64: string }
export interface ChatRoles { customers: string[]; staff: string[] }
export interface KnowledgeImportInput { files?: KnowledgeImportFile[]; text?: string; textKind?: 'document' | 'chat'; sourceName?: string; chatRoles?: ChatRoles; url?: string }
export interface KnowledgeImportRow extends KnowledgeDraft { rowId: string; errors: string[]; duplicateOf?: string }
export interface KnowledgeOrganization {
  summary: string;
  missing: string[];
  workflow: { name: string; scenario: Scenario; description: string; instructions: string; greeting: string };
}
/** A manual import whose source name matches entries kept from an earlier manual import of the same file. */
export interface KnowledgeImportReplaces { source: string; count: number }
export interface KnowledgeImportPreview { previewId: string; expiresAt: string; rows: KnowledgeImportRow[]; warnings: string[]; organization?: KnowledgeOrganization; replaces?: KnowledgeImportReplaces[]; committedRowIds?: string[] }
export interface KnowledgeImportCommit { previewId: string; rows: Array<Omit<KnowledgeDraft, 'source' | 'sourceLocator'> & { rowId: string }>; confirm: true; replacePrevious?: boolean }
/** Partial review result: approved ids and the entries that were left pending, each with a plain reason. */
export interface KnowledgeReviewConflict { id: string; title: string; reason: string; conflictIds: string[] }
export interface KnowledgeReviewResult { approved: string[]; conflicts: KnowledgeReviewConflict[]; retired: string[] }
export interface KnowledgeHit { id: string; title: string; content: string; question?: string; source?: string; sourceLocator?: string; score: number; matchedTerms: string[]; matchedFields: string[] }
export interface KnowledgeSearchInput { query: string; scenario?: Scenario | 'all'; ids?: string[]; /** Internal ranking callers may ask for up to 80 hits; the default is 5. */ limit?: number }
export interface KnowledgeSearchResult { query: string; hits: KnowledgeHit[]; status: 'matched' | 'no_match'; note: string }
export interface KnowledgeEvaluationInput { cases: Array<{ question: string; expectedTitle?: string }>; scenario?: Scenario | 'all' }
export interface KnowledgeEvaluationResult { total: number; matched: number; passed: number; results: Array<KnowledgeSearchResult & { expectedTitle?: string; passed: boolean }> }
