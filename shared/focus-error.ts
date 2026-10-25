/** Only native allowlisted categories are displayed; no window titles or raw errors. */
export function focusLossDetail(message: string): string {
  const kind = /(?:^|;\s*)focus_source=(assistant|codex|chat_app_other|ime|other|none)(?:;|$)/.exec(message)?.[1];
  const labels: Record<string, string> = {
    assistant: '前台已切换到咔哒或其他 Electron 窗口。',
    codex: '前台已切换到 Codex。',
    chat_app_other: '前台已切换到目标应用的另一个窗口。',
    ime: '前台已切换到输入法窗口。',
    other: '前台已切换到其他应用。',
    none: 'Windows 正在切换前台窗口。',
  };
  return kind ? labels[kind] : '';
}
