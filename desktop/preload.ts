import { contextBridge, ipcRenderer } from 'electron';
import { diagnosticCode, diagnosticScope } from '../shared/diagnostics';
import { productMessage } from '../shared/product-copy';
import type { ApiRequest } from '../shared/types.ts';

const invoke = async (channel: string, ...args: unknown[]) => {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (e) {
    if (!channel.startsWith('flowdesk:diagnostics:')) {
      void ipcRenderer.invoke(
        'flowdesk:diagnostics:record',
        diagnosticScope(channel === 'flowdesk:request' ? String((args[0] as ApiRequest)?.path || 'request') : channel),
        diagnosticCode(e)
      ).catch(() => {});
    }
    throw new Error(productMessage(e instanceof Error ? e.message : '操作失败，请重试。'));
  }
};

contextBridge.exposeInMainWorld('flowdesk', {
  diagnostics: {
    report: () => invoke('flowdesk:diagnostics:report'),
    copy: () => invoke('flowdesk:diagnostics:copy'),
    save: () => invoke('flowdesk:diagnostics:save'),
    record: (scope: unknown, code: unknown) => invoke('flowdesk:diagnostics:record', scope, code),
    feedback: (description: string) => invoke('flowdesk:diagnostics:feedback', description)
  },
  knowledgeLibrary: {
    status: () => invoke('flowdesk:library:status'),
    create: () => invoke('flowdesk:library:create'),
    choose: () => invoke('flowdesk:library:choose'),
    open: (which?: 'source' | 'pending' | 'live' | 'old' | 'images') => invoke('flowdesk:library:open', which),
    sync: () => invoke('flowdesk:library:sync'),
    backupChoose: () => invoke('flowdesk:library:backup-choose'),
    backupUse: (path: string) => invoke('flowdesk:library:backup-use', path),
    backupNow: () => invoke('flowdesk:library:backup-now'),
    backupClear: () => invoke('flowdesk:library:backup-clear')
  },
  knowledgeSources: {
    pickFolder: () => invoke('flowdesk:knowledge:pick-folder'),
    authorizeDrive: (kind: string) => invoke('flowdesk:knowledge:authorize-drive', kind)
  },
  knowledgeRepos: {
    pickFolder: () => invoke('flowdesk:knowledge:pick-repo-folder')
  },
  openOfficial: (url: string) => invoke('flowdesk:open-official', url),
  update: {
    check: () => invoke('flowdesk:update:check'),
    state: () => invoke('flowdesk:update:state'),
    open: (url: string) => invoke('flowdesk:update:open', url),
    setAuto: (on: boolean) => invoke('flowdesk:update:set-auto', on),
    applyNow: () => invoke('flowdesk:update:apply-now')
  },
  support: {
    bundle: () => invoke('flowdesk:support:bundle')
  },
  loginItem: {
    state: () => invoke('flowdesk:login-item:state'),
    set: (on: boolean) => invoke('flowdesk:login-item:set', on)
  },
  customers: {
    state: () => invoke('flowdesk:customers:state'),
    setCapture: (v: unknown) => invoke('flowdesk:customers:set-capture', v),
    saveFollowUpSettings: (v: unknown) => invoke('flowdesk:customers:save-followup-settings', v),
    saveLines: (v: unknown) => invoke('flowdesk:customers:save-lines', v),
    seedLines: () => invoke('flowdesk:customers:seed-lines'),
    add: (name: string, channel?: string) => invoke('flowdesk:customers:add', name, channel),
    setFact: (id: string, field: string, value: string) => invoke('flowdesk:customers:set-fact', id, field, value),
    rename: (id: string, name: string, aliases: string[]) => invoke('flowdesk:customers:rename', id, name, aliases),
    setTags: (id: string, tags: string[]) => invoke('flowdesk:customers:set-tags', id, tags),
    addNote: (id: string, text: string) => invoke('flowdesk:customers:add-note', id, text),
    removeNote: (id: string, at: string) => invoke('flowdesk:customers:remove-note', id, at),
    setNext: (id: string, at: string, reason: string) => invoke('flowdesk:customers:set-next', id, at, reason),
    addPurchase: (id: string, input: unknown) => invoke('flowdesk:customers:add-purchase', id, input),
    removePurchase: (id: string, purchaseId: string) => invoke('flowdesk:customers:remove-purchase', id, purchaseId),
    merge: (into: string, from: string) => invoke('flowdesk:customers:merge', into, from),
    remove: (id: string) => invoke('flowdesk:customers:remove', id),
    saveSegment: (name: string, filter: unknown) => invoke('flowdesk:customers:save-segment', name, filter),
    removeSegment: (id: string) => invoke('flowdesk:customers:remove-segment', id),
    makeList: () => invoke('flowdesk:customers:make-list'),
    approve: (id: string) => invoke('flowdesk:customers:approve', id),
    edit: (id: string, text: string) => invoke('flowdesk:customers:edit', id, text),
    skip: (id: string) => invoke('flowdesk:customers:skip', id),
    redraft: (id: string) => invoke('flowdesk:customers:redraft', id),
    createBroadcast: (input: unknown) => invoke('flowdesk:customers:create-broadcast', input),
    editBroadcastItem: (id: string, profileId: string, text: string) => invoke('flowdesk:customers:edit-broadcast-item', id, profileId, text),
    removeBroadcastItem: (id: string, profileId: string, removed: boolean) => invoke('flowdesk:customers:remove-broadcast-item', id, profileId, removed),
    startBroadcast: (id: string) => invoke('flowdesk:customers:start-broadcast', id),
    stopBroadcast: (id: string) => invoke('flowdesk:customers:stop-broadcast', id),
    removeBroadcast: (id: string) => invoke('flowdesk:customers:remove-broadcast', id),
    importPick: () => invoke('flowdesk:customers:import-pick'),
    importCommit: (token: string, mapping: string[], line?: string) => invoke('flowdesk:customers:import-commit', token, mapping, line),
    exportCsv: (filter: unknown) => invoke('flowdesk:customers:export', filter)
  },
  plugins: {
    state: () => invoke('flowdesk:plugins:state'),
    preview: (text: string) => invoke('flowdesk:plugins:preview', text),
    install: (text: string, consent: boolean) => invoke('flowdesk:plugins:install', text, consent),
    setEnabled: (id: string, enabled: boolean) => invoke('flowdesk:plugins:set-enabled', id, enabled),
    uninstall: (id: string) => invoke('flowdesk:plugins:uninstall', id),
    undo: () => invoke('flowdesk:plugins:undo'),
    refreshTools: (id: string) => invoke('flowdesk:plugins:refresh-tools', id),
    setTool: (id: string, tool: string, input: unknown) => invoke('flowdesk:plugins:set-tool', id, tool, input),
    saveRules: (id: string, rules: unknown) => invoke('flowdesk:plugins:save-rules', id, rules),
    createAutomation: (name: string) => invoke('flowdesk:plugins:create-automation', name),
    answerApproval: (id: string, approve: boolean) => invoke('flowdesk:plugins:answer-approval', id, approve),
    evolution: () => invoke('flowdesk:plugins:evolution'),
    adopt: (id: string) => invoke('flowdesk:plugins:adopt', id),
    dismiss: (id: string) => invoke('flowdesk:plugins:dismiss', id)
  },
  open: {
    state: () => invoke('flowdesk:open:state'),
    save: (input: { enabled?: boolean; port?: number; regenerateToken?: boolean; disabledTools?: string[]; appTasks?: boolean }) => invoke('flowdesk:open:save', input),
    tasks: () => invoke('flowdesk:open:tasks'),
    approveTask: (taskId: string) => invoke('flowdesk:open:task-approve', taskId),
    rejectTask: (taskId: string) => invoke('flowdesk:open:task-reject', taskId),
    unlockTasks: (key: string) => invoke('flowdesk:open:task-unlock', key),
    addClient: (input: { label: string; tool?: string }) => invoke('flowdesk:open:client-add', input),
    removeClient: (id: string) => invoke('flowdesk:open:client-remove', id),
    regenerateClientKey: (id: string) => invoke('flowdesk:open:client-regenerate-key', id),
    copyClientKey: (id: string) => invoke('flowdesk:open:client-copy-key', id),
    setClientAppTasks: (id: string, allowed: boolean) => invoke('flowdesk:open:client-set-app-tasks', id, allowed)
  },
  shortcuts: {
    state: () => invoke('flowdesk:shortcuts:state'),
    suspend: (suspended: boolean) => invoke('flowdesk:shortcuts:suspend', suspended),
    save: (input: unknown) => invoke('flowdesk:shortcuts:save', input)
  },
  notice: {
    onShow: (listener: (card: unknown) => void) => {
      const wrapped = (_event: unknown, card: unknown) => listener(card);
      ipcRenderer.on('flowdesk:notice:show', wrapped);
      return () => { ipcRenderer.removeListener('flowdesk:notice:show', wrapped); };
    },
    act: (id: string, action: unknown) => invoke('flowdesk:notice:act', id, action),
    list: () => invoke('flowdesk:notice:list'),
    unmute: (key: string) => invoke('flowdesk:notice:unmute', key)
  },
  request: (request: ApiRequest) => invoke('flowdesk:request', request),
  copyText: (text: string) => invoke('flowdesk:copy-text', text),
  version: () => invoke('flowdesk:version'),
  setWindowMode: (mode: 'compact' | 'expanded' | 'minimize' | 'restore') => invoke('flowdesk:window:mode', mode)
});
