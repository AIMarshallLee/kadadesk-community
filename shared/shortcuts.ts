/** Global shortcuts the user can change (设置 → 快捷键). Values are Electron accelerators. */
export interface ShortcutSettings { pause: string; stop: string }
export type ShortcutAction = keyof ShortcutSettings;
/**
 * Same keys on Mac and Windows. Control+Option+Esc on Mac, not Command+Option+Esc: that one is the system's
 * 强制退出 window. Control+Alt+K: K for kada, one hand, never types a letter (the system takes the key).
 */
export const DEFAULT_SHORTCUTS: ShortcutSettings = { pause: 'Control+Alt+K', stop: 'Control+Alt+Escape' };
export const SHORTCUT_LABELS: Record<ShortcutAction, { title: string; detail: string }> = {
  pause: { title: '暂停 / 继续接待', detail: '按一次暂停（正在发的这条发完就停），再按一次继续。' },
  stop: { title: '急停', detail: '咔哒正在动键盘鼠标时，按它立即停下所有操作。' },
};

const MODIFIERS = ['Control', 'Alt', 'Shift', 'Command'] as const;
type Modifier = typeof MODIFIERS[number];
const KEY = /^([A-Z]|[0-9]|F([1-9]|1[0-9]|2[0-4])|Escape|Space|Tab|Backspace|Delete|Enter|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert|Plus|-|=|\[|\]|;|'|,|\.|\/|\\|`)$/;

/** A usable global shortcut: at least Control, Alt or Command plus one key. Shift alone would steal typing. */
export function validShortcut(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 60) return false;
  const parts = value.split('+');
  const key = parts.pop() ?? '';
  const mods = parts;
  if (!KEY.test(key) || new Set(mods).size !== mods.length) return false;
  if (!mods.every(m => (MODIFIERS as readonly string[]).includes(m))) return false;
  return mods.some(m => m !== 'Shift');
}

export function parseShortcuts(value: unknown): ShortcutSettings {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<ShortcutSettings>;
  const pause = validShortcut(v.pause) ? v.pause : DEFAULT_SHORTCUTS.pause;
  const stop = validShortcut(v.stop) && v.stop !== pause ? v.stop : DEFAULT_SHORTCUTS.stop;
  return { pause, stop: stop === pause ? DEFAULT_SHORTCUTS.stop : stop };
}

const MAC_SYMBOL: Record<Modifier, string> = { Control: '⌃', Alt: '⌥', Shift: '⇧', Command: '⌘' };
const WIN_NAME: Record<Modifier, string> = { Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Command: 'Win' };
const KEY_NAME: Record<string, string> = { Escape: 'Esc', Space: '空格', Up: '↑', Down: '↓', Left: '←', Right: '→', Enter: '回车', Backspace: '退格', Delete: 'Del' };

/** How a shortcut is written for people: ⌃⌥K on Mac, Ctrl+Alt+K on Windows. */
export function displayShortcut(value: string, mac: boolean) {
  const parts = value.split('+'); const key = parts.pop() ?? '';
  const order = MODIFIERS.filter(m => parts.includes(m));
  const k = KEY_NAME[key] ?? key;
  return mac ? order.map(m => MAC_SYMBOL[m]).join('') + k : [...order.map(m => WIN_NAME[m]), k].join('+');
}

/** The shortcut a key press in the recorder means; undefined while only modifiers are held. */
export function shortcutFromKey(event: { code: string; key: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }): string | undefined {
  const code = event.code;
  let key: string | undefined;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code;
  else key = ({ Escape: 'Escape', Space: 'Space', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Enter: 'Enter', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Backquote: '`' } as Record<string, string>)[code];
  if (!key) return undefined;
  const mods = [event.ctrlKey && 'Control', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Command'].filter(Boolean);
  return [...mods, key].join('+');
}
