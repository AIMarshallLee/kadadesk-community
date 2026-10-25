/** 主题色. Every accent colour is hsl(var(--a-h) …) (styles.css), so a theme only sets data-theme on <html>.
 * 昆仑紫 is the default; everyone can choose another one (personalisation is not a paid feature). */
export type ThemeId = 'purple' | 'green' | 'blue' | 'teal' | 'amber' | 'rose' | 'graphite';
export const THEMES: ReadonlyArray<{ id: ThemeId; label: string; swatch: string }> = [
  { id: 'purple', label: '昆仑紫（默认）', swatch: '#4a265f' },
  { id: 'blue', label: '商务蓝', swatch: '#1f4f9e' },
  { id: 'teal', label: '青碧', swatch: '#1d6f63' },
  { id: 'green', label: '经典绿', swatch: '#3d6223' },
  { id: 'amber', label: '琥珀橙', swatch: '#9a4f12' },
  { id: 'rose', label: '玫瑰红', swatch: '#8f2a4a' },
  { id: 'graphite', label: '石墨灰', swatch: '#3a3d46' },
];
const KEY = 'kadadesk.theme';
export function savedTheme(): ThemeId {
  try { const v = localStorage.getItem(KEY); return THEMES.some(t => t.id === v) ? v as ThemeId : 'purple'; } catch { return 'purple'; }
}
export function applyTheme(theme: ThemeId) {
  if (theme === 'purple') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme;
}
export function saveTheme(theme: ThemeId) {
  try { if (theme === 'purple') localStorage.removeItem(KEY); else localStorage.setItem(KEY, theme); } catch { /* applied for this session only */ }
  applyTheme(theme);
}

