/** Text that outside callers put in front of the owner (app-task instructions, client labels) must read exactly as it
 *  will be shown. Control, format (bidi, zero-width, tag), surrogate, private-use, unassigned, line/paragraph
 *  separators and other default-ignorable code points can hide or reorder words; blank look-alikes pad them out; corner
 *  brackets can imitate kadadesk's own wording around quoted text. Both raw and NFKC forms are checked. */

const HIDDEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;
const BLANKS = new Set([0x2800, 0x3164, 0xffa0, 0x115f, 0x1160]);
const MIMICS = /[「」『』【】〖〗]/u;

export const hasHiddenCharacters = (text: string) => [text, text.normalize('NFKC')].some(form => HIDDEN.test(form) || [...form].some(char => BLANKS.has(char.codePointAt(0) ?? 0)));
export const hasMimicBrackets = (text: string) => MIMICS.test(text) || MIMICS.test(text.normalize('NFKC'));
