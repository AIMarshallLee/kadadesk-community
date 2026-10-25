export declare const MANUAL_DIR: string;
export declare const MANUAL_MODULE: string;
export declare const CHANGELOG_FILE: string;
export declare function readManualSources(root?: string): Array<{ file: string; markdown: string }>;
export declare function renderManualModule(sources: Array<{ file: string; markdown: string }>): string;
export declare function changelogVersions(markdown: string): string[];
export declare function changelogEntry(markdown: string, version: string): string;
export declare function checkManual(root?: string): { version: string; problems: string[] };
export declare function assertManualReady(root?: string): string;
