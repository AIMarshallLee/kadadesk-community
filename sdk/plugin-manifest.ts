/**
 * Plugin manifest contract V1（对应 docs/PLUGIN-ARCHITECTURE-V1.md 第五节提案）。
 *
 * 当前宿主只允许源码内置的可信插件（见 server/plugin-host.ts 的 allowlist），
 * 动态安装、签名校验与沙箱尚未实现。本模块只做**清单结构校验**：
 * 让内置插件、示例插件和未来的打包工具在开发期就能发现清单错误，
 * 不代表宿主已支持安装第三方插件包。
 */

export const MANIFEST_SCHEMA_VERSION = 1;

export const PLUGIN_PLATFORMS = ['windows', 'macos', 'server'] as const;
export type PluginPlatform = (typeof PLUGIN_PLATFORMS)[number];

export type PluginManifest = {
  schemaVersion: 1;
  /** 倒序域名风格，如 com.kadadesk.knowledge */
  id: string;
  name: string;
  version: string;
  minHostVersion: string;
  platforms: PluginPlatform[];
  /** 如 workspace:knowledge.read、local-data:content-ops */
  permissions: string[];
  dependencies: string[];
  /** 相对插件包根目录的路径 */
  uiEntry?: string;
  runtimeEntry?: string;
  /** 发布者签名，由打包/签名工具在发布时填写 */
  publisher?: string;
  /** 发布产物的 SHA-256，由打包/签名工具在发布时填写 */
  sha256?: string;
};

const ID_RE = /^com\.[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const PERMISSION_RE = /^[a-z0-9][a-z0-9-]*:[a-z0-9][a-z0-9.*-]*$/;
const ENTRY_RE = /^(?!\/)(?!\.\.?(?:\/|$))[A-Za-z0-9._/-]+\.js$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

export type ManifestValidationResult =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkStringArray(errors: string[], field: string, value: unknown, re: RegExp, required: boolean): void {
  if (value === undefined) {
    if (required) errors.push(`${field} 缺失`);
    return;
  }
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string' || !re.test(v))) {
    errors.push(`${field} 必须为符合 ${re.source} 的字符串数组`);
  }
}

function checkEntry(errors: string[], field: string, value: unknown): void {
  if (value === undefined) return;
  if (typeof value !== 'string' || !ENTRY_RE.test(value)) {
    errors.push(`${field} 必须是插件包内的相对 .js 路径（不允许绝对路径或 ..）`);
  }
}

/**
 * 校验插件清单。返回聚合错误列表而不是抛出，方便打包工具一次性展示全部问题。
 */
export function validatePluginManifest(input: unknown): ManifestValidationResult {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ['清单必须是 JSON 对象'] };

  if (input.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    errors.push(`schemaVersion 必须为 ${MANIFEST_SCHEMA_VERSION}`);
  }
  if (typeof input.id !== 'string' || !ID_RE.test(input.id)) {
    errors.push('id 必须为倒序域名风格（如 com.kadadesk.knowledge）');
  }
  if (typeof input.name !== 'string' || input.name.trim().length === 0 || input.name.length > 64) {
    errors.push('name 必须为 1-64 字符');
  }
  for (const field of ['version', 'minHostVersion'] as const) {
    if (typeof input[field] !== 'string' || !SEMVER_RE.test(input[field] as string)) {
      errors.push(`${field} 必须为语义化版本（如 0.2.0 或 1.0.0-beta.1）`);
    }
  }
  if (
    !Array.isArray(input.platforms) ||
    input.platforms.length === 0 ||
    !input.platforms.every(p => (PLUGIN_PLATFORMS as readonly string[]).includes(p as PluginPlatform))
  ) {
    errors.push(`platforms 必须为 ${PLUGIN_PLATFORMS.join('/')} 的非空子集`);
  }
  checkStringArray(errors, 'permissions', input.permissions, PERMISSION_RE, true);
  checkStringArray(errors, 'dependencies', input.dependencies, ID_RE, false);
  checkEntry(errors, 'uiEntry', input.uiEntry);
  checkEntry(errors, 'runtimeEntry', input.runtimeEntry);
  if (input.publisher !== undefined && (typeof input.publisher !== 'string' || input.publisher.length === 0)) {
    errors.push('publisher 填写时必须为非空字符串');
  }
  if (input.sha256 !== undefined && (typeof input.sha256 !== 'string' || !SHA256_RE.test(input.sha256))) {
    errors.push('sha256 填写时必须为 64 位小写十六进制摘要');
  }
  if (errors.length > 0) return { ok: false, errors };

  const manifest = input as unknown as PluginManifest;
  if (manifest.dependencies.includes(manifest.id)) {
    return { ok: false, errors: ['dependencies 不允许包含自身'] };
  }
  return { ok: true, manifest };
}
