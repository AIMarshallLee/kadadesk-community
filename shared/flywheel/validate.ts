import Ajv2020 from 'ajv/dist/2020';
import schema from './flywheel-v1.schema.json';

/**
 * The authoritative flywheel.v1 schema (copied byte for byte from the knowledge base; the test checks its sha256),
 * compiled once on first use. Every event kadadesk builds is checked here before it may enter the outbox.
 */
export const FLYWHEEL_SCHEMA_SHA256 = '22d4a509bf1eae8f19b9ac7d66597437310b8bf50321a0b4e3f00607bf31a9a8';

type Validator = ((data: unknown) => boolean) & { errors?: Array<{ instancePath: string; message?: string }> | null };
let compiled: Validator | undefined;
function validator(): Validator {
  if (!compiled) {
    // `format: uri` appears only in content.published (never written by kadadesk); formats are not enforced.
    const AjvClass = ((Ajv2020 as unknown as { default?: typeof Ajv2020 }).default ?? Ajv2020) as typeof Ajv2020;
    const ajv = new AjvClass({ strict: false, allErrors: false, validateFormats: false });
    compiled = ajv.compile(schema as object) as Validator;
  }
  return compiled;
}

/** undefined when the event is valid; otherwise a short reason (field path + rule) for the 「出错」 count. */
export function flywheelEventError(event: unknown): string | undefined {
  const v = validator();
  if (v(event)) return undefined;
  const e = v.errors?.[0];
  return e ? `${e.instancePath || '/'} ${e.message ?? 'invalid'}`.slice(0, 160) : 'invalid';
}
