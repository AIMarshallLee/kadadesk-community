/** Customer names are independent of persisted storage / firmware identifiers. */
export const brandName = '咔哒';
export const brandEnglishName = 'kadadesk';
export function isAssistantWindow(title: string) {
  return /^(咔哒|kadadesk|FlowDesk|GhostDesk)(?:\s|[—·-]|$)/i.test(title);
}
