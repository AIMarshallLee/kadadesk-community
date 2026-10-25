/** 图标款式: the purple mascot in ten looks the user can pick from (设置 → 图标款式). 'default' is the shipped icon. */
export const MASCOT_ICONS = [
  { id: 'default', label: '默认', note: '安装时的小紫怪' },
  { id: 'classic', file: 'kada-01.png', label: '经典款', note: '简洁耐看，适合长期使用' },
  { id: 'lively', file: 'kada-02.png', label: '活力款', note: '更有亲和力，年轻有活力' },
  { id: 'tech', file: 'kada-03.png', label: '科技款', note: '突出 AI 和智能感' },
  { id: 'peek', file: 'kada-04.png', label: '探头款', note: '有趣可爱，识别度高' },
  { id: 'happy', file: 'kada-05.png', label: '开心款', note: '情绪积极，适合传播场景' },
  { id: 'work', file: 'kada-06.png', label: '工作款', note: '贴合产品定位，场景感强' },
  { id: 'side', file: 'kada-07.png', label: '侧脸款', note: '简洁大气，风格独特' },
  { id: 'explore', file: 'kada-08.png', label: '探索款', note: '体现发现与效率' },
  { id: 'starry', file: 'kada-09.png', label: '星空款', note: '有想象力，延展性强' },
  { id: 'minimal', file: 'kada-10.png', label: '极简款', note: '适合小尺寸，识别度高' },
] as const;
export type MascotIconId = typeof MASCOT_ICONS[number]['id'];
export const isMascotIcon = (v: unknown): v is MascotIconId => typeof v === 'string' && MASCOT_ICONS.some(m => m.id === v);
/** Path under the app's public root (served at flowdesk://app/mascots/…); undefined for the shipped icon. */
export function mascotIconFile(id: MascotIconId): string | undefined {
  const m = MASCOT_ICONS.find(x => x.id === id);
  return m && 'file' in m ? `mascots/${m.file}` : undefined;
}
