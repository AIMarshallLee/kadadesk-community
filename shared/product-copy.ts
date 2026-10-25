/** Product-generated diagnostics only. Never apply to customer messages or window identities. */
export function productMessage(value:string):string {
  return value.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,'').replace(/聊天软件/g,'目标应用').replace(/\bPico\b/gi,'皮卡');
}
