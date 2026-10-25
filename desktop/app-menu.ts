import type { MenuItemConstructorOptions } from 'electron';
export type MenuLanguage = 'zh-CN' | 'en';
export function applicationMenu(language: MenuLanguage, changeLanguage: (language: MenuLanguage) => void): MenuItemConstructorOptions[] {
  const label = (zh: string, en: string) => language === 'en' ? en : zh;
  const role = (value: MenuItemConstructorOptions['role'], zh: string, en: string): MenuItemConstructorOptions => ({ role: value, label: label(zh, en) });
  return [
    { label: label('文件', 'File'), submenu: [role('close', '关闭窗口', 'Close Window'), { type: 'separator' }, role('quit', '退出咔哒', 'Quit kadadesk')] },
    { label: label('编辑', 'Edit'), submenu: [role('undo', '撤销', 'Undo'), role('redo', '重做', 'Redo'), { type: 'separator' }, role('cut', '剪切', 'Cut'), role('copy', '复制', 'Copy'), role('paste', '粘贴', 'Paste'), role('delete', '删除', 'Delete'), { type: 'separator' }, role('selectAll', '全选', 'Select All')] },
    { label: label('查看', 'View'), submenu: [role('reload', '重新加载', 'Reload'), role('forceReload', '强制重新加载', 'Force Reload'), role('toggleDevTools', '开发者工具', 'Developer Tools'), { type: 'separator' }, role('resetZoom', '实际大小', 'Actual Size'), role('zoomIn', '放大', 'Zoom In'), role('zoomOut', '缩小', 'Zoom Out'), { type: 'separator' }, role('togglefullscreen', '切换全屏', 'Toggle Full Screen')] },
    { label: label('窗口', 'Window'), submenu: [role('minimize', '最小化', 'Minimize'), role('zoom', '最大化 / 还原', 'Maximize / Restore'), role('close', '关闭窗口', 'Close Window')] },
    { label: label('菜单语言', 'Menu Language'), submenu: [
      { label: '简体中文', type: 'radio', checked: language === 'zh-CN', click: () => changeLanguage('zh-CN') },
      { label: 'English', type: 'radio', checked: language === 'en', click: () => changeLanguage('en') },
    ] },
  ];
}
