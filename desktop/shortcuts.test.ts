import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SHORTCUTS, displayShortcut, parseShortcuts, shortcutFromKey, validShortcut } from '../shared/shortcuts.ts';

test('defaults are the same keys on both platforms and avoid the macOS Force Quit combination', () => {
  assert.deepEqual(DEFAULT_SHORTCUTS, { pause: 'Control+Alt+K', stop: 'Control+Alt+Escape' });
  assert.equal(displayShortcut(DEFAULT_SHORTCUTS.pause, true), '⌃⌥K');
  assert.equal(displayShortcut(DEFAULT_SHORTCUTS.stop, true), '⌃⌥Esc');
  assert.equal(displayShortcut(DEFAULT_SHORTCUTS.stop, false), 'Ctrl+Alt+Esc');
  assert.notEqual(DEFAULT_SHORTCUTS.stop, 'Command+Alt+Escape');
});

test('a shortcut needs Control, Alt or Command; plain letters and Shift-only would steal typing', () => {
  assert.equal(validShortcut('Control+Alt+K'), true);
  assert.equal(validShortcut('Command+Shift+F8'), true);
  assert.equal(validShortcut('K'), false);
  assert.equal(validShortcut('Shift+K'), false);
  assert.equal(validShortcut('A+D+K'), false);
  assert.equal(validShortcut('Control+Control+K'), false);
  assert.equal(validShortcut('Control+Alt+'), false);
});

test('saved settings fall back to defaults when broken or clashing', () => {
  assert.deepEqual(parseShortcuts({ pause: 'K', stop: 'Control+Alt+S' }), { pause: 'Control+Alt+K', stop: 'Control+Alt+S' });
  assert.deepEqual(parseShortcuts({ pause: 'Control+Alt+S', stop: 'Control+Alt+S' }), { pause: 'Control+Alt+S', stop: 'Control+Alt+Escape' });
  assert.deepEqual(parseShortcuts(null), DEFAULT_SHORTCUTS);
});

test('the recorder reads the physical key, so Option does not turn K into ˚', () => {
  const press = (code: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) => shortcutFromKey({ code, key: '˚', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });
  assert.equal(press('KeyK', { ctrlKey: true, altKey: true }), 'Control+Alt+K');
  assert.equal(press('Escape', { ctrlKey: true, altKey: true }), 'Control+Alt+Escape');
  assert.equal(press('ControlLeft', { ctrlKey: true }), undefined);
  assert.equal(press('Digit5', { metaKey: true, shiftKey: true }), 'Shift+Command+5');
  assert.equal(validShortcut('Shift+Command+5'), true);
});
