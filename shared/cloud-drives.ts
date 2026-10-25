export const driveNames = {baidu:'百度网盘',alipan:'阿里云盘',google:'Google Drive',onedrive:'OneDrive'} as const;
export type DriveKind = keyof typeof driveNames;
export const driveKinds = Object.keys(driveNames) as DriveKind[];
export function driveKind(value:unknown):DriveKind {
  if(typeof value==='string'&&Object.hasOwn(driveNames,value))return value as DriveKind;
  throw Error('请选择支持的网盘。');
}
export interface DriveRef {id:string;driveId?:string}
export interface DriveEntry {handle:string;name:string;folder:boolean;size?:number;supported:boolean}
export interface DrivePage {entries:DriveEntry[];next?:string}
export interface DriveStatus {
  configured:boolean;connected:boolean;clientId?:string;hasSecret:boolean;
  auth:'idle'|'waiting'|'exchanging'|'connected'|'error';message:string;
}
export interface DrivesView {persistent:boolean;providers:Record<DriveKind,DriveStatus>}
export const driveRedirect = 'http://127.0.0.1:38467/oauth/callback';
