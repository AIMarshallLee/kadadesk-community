/**
 * Which files a knowledge import reads. Shared by folder sources (server), ZIP / GitHub expansion (server) and the
 * one-step import panel (renderer), so a folder dragged into the app and the same folder added as a source agree.
 */
export const KNOWLEDGE_FILE_EXTENSIONS = ['.pdf', '.docx', '.xlsx', '.csv', '.json', '.txt', '.md', '.html', '.htm'] as const;
const supported = new Set<string>(KNOWLEDGE_FILE_EXTENSIONS);

/** One 「一股脑丢进来」 run: what is read at most; the rest is reported as skipped. */
export const ONE_STEP_IMPORT_LIMITS = { files: 1000, totalBytes: 64 * 1024 * 1024, organizedRows: 600, zipBytes: 32 * 1024 * 1024 };

/** Office lock files (~$价格表.docx), temporary downloads and OS thumbnails are never business documents. */
export const ignoredDocumentName = (name: string) => name.startsWith('.') || name.startsWith('~$') || /\.(tmp|temp|crdownload|part|partial|download)$/i.test(name) || /^(thumbs\.db|desktop\.ini|ehthumbs\.db)$/i.test(name);

/** Folders that hold tooling, version history or archive metadata, not business documents. */
const IGNORED_FOLDERS = new Set(['.git', 'node_modules', '__macosx', '.svn', '.hg', '.idea', '.vscode']);

/** A path inside a dropped folder, ZIP or repository: skipped when any part of it is hidden, tooling or a lock file. */
export function ignoredDocumentPath(path: string) {
  const parts = path.replaceAll('\\', '/').split('/').filter(Boolean);
  return parts.some(part => IGNORED_FOLDERS.has(part.toLowerCase()) || ignoredDocumentName(part));
}

export const documentExtension = (name: string) => { const dot = name.lastIndexOf('.'); return dot < 0 ? '' : name.slice(dot).toLowerCase(); };
export const supportedDocumentName = (name: string) => supported.has(documentExtension(name));
export const zipFileName = (name: string) => documentExtension(name) === '.zip';

/**
 * File names may not contain a path in an import, but the folder a file came from is useful provenance
 * (「仓库名／docs／价格.md」). The fullwidth slash keeps it readable; long names keep their end, which holds the file name.
 */
export function importNameFromPath(path: string) {
  const parts = path.replaceAll('\\', '/').split('/').map(p => p.trim()).filter(p => p && p !== '.' && p !== '..');
  const name = parts.join('／') || '未命名';
  return name.length <= 200 ? name : '…' + name.slice(name.length - 199);
}
