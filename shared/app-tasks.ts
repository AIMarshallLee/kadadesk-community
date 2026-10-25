/** App tasks queued through 开放 (docs/open-mcp-app-operation.md). Shared by the main process and the 开放 page. */

export type AppTaskStatus = 'queued' | 'approved' | 'running' | 'completed' | 'stopped' | 'failed' | 'expired' | 'interrupted' | 'rejected' | 'cancelled';
export interface AppTaskStep { kind: string; outcome: string }
export interface AppTaskView {
  taskId: string; no: number; label: string; app: string; appLabel: string; instruction: string; maxSteps: number;
  status: AppTaskStatus; createdAt: string; updatedAt: string; approvedVia?: 'local' | 'remote';
  /** False when the approval message could not be queued for the admin WeChat chat (no admin contact). */
  remoteApproval?: boolean;
  steps: AppTaskStep[]; result?: string; error?: string;
}
/** What the 开放 page shows: recent tasks, callers locked after repeated rejections, whether desk approval is possible. */
export interface AppTasksPanel { tasks: AppTaskView[]; locked: string[]; localApproval: boolean; apps: Record<string, string>; error?: string }

export const APP_TASK_STATUS_TEXT: Record<AppTaskStatus, string> = {
  queued: '待批准', approved: '已批准', running: '执行中', completed: '已完成', stopped: '已停止',
  failed: '失败', expired: '已过期', interrupted: '已中断', rejected: '已拒绝', cancelled: '已取消',
};
