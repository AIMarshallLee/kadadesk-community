import { useEffect, useState } from 'react';
import { Button } from './components';
import { APP_TASK_STATUS_TEXT, type AppTasksPanel } from '../shared/app-tasks';

const time = (at: string) => new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

/** 应用操作 on the 开放 page: the switch, tasks waiting for the owner, and recent results.
 *  Approving here asks for Touch ID; the admin WeChat reply 「允许 编号」 plus an authenticator code is the remote path. */
export default function OpenAppTasks({ enabled, disabled, labels, onToggle, notify }: { enabled: boolean; disabled: boolean; labels: Record<string, string>; onToggle: (value: boolean) => void; notify: (message: string, error?: boolean) => void }) {
  const bridge = window.flowdesk?.open;
  const [panel, setPanel] = useState<AppTasksPanel>();
  const [acting, setActing] = useState('');
  useEffect(() => {
    const refresh = () => bridge?.tasks?.().then(setPanel).catch(() => {});
    void refresh(); const timer = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(timer);
  }, [bridge]);
  if (!bridge) return null;
  const act = async (id: string, action: () => Promise<AppTasksPanel>, done: string) => {
    setActing(id);
    try { setPanel(await action()); notify(done); } catch (e) { notify((e as Error).message, true); } finally { setActing(''); }
  };
  const tasks = panel?.tasks ?? [];
  return <section className="panel dr-panel">
    <div className="dr-section-head"><div><h2>应用操作（试验）</h2><p>允许你在「客户端」里勾选了权限的 AI 工具请咔哒在电脑应用里执行短任务。请求只会排队：你在这里用 Touch ID 批准，或在管理员聊天回复「允许 编号」加手机验证器上的 6 位数后才执行，10 分钟内没批准就作废。聊天批准需要自动接待在运行，并且设置了验证器。目前只有「合成演练」：不截屏、不输入、不调用模型，用来先验证批准流程。</p></div></div>
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><input id="open-app-tasks" type="checkbox" disabled={disabled || !!panel?.error} checked={enabled} onChange={e => onToggle(e.target.checked)} />开启应用操作</label>
    {panel?.error ? <p className="muted">任务记录无法加载，应用操作不可用：{panel.error}</p> : null}
    {(panel?.locked ?? []).map(key => <p key={key}>「{labels[key] ?? key}」的任务接连被拒绝或验证码错误过多，已暂停接收它的应用任务。 <Button variant="secondary" disabled={acting !== ''} onClick={() => void act(`unlock-${key}`, () => (bridge as any).unlockTasks?.(key), `已重新开启「${labels[key] ?? key}」`)}>重新开启</Button></p>)}
    {panel && !panel.localApproval ? <p className="muted">这台电脑现在不能用 Touch ID，没法在电脑前批准任务。</p> : null}
    
    {tasks.length ? <table className="open-tools"><tbody>{tasks.map(task => <tr key={task.taskId}>
      <td>#{task.no} · {APP_TASK_STATUS_TEXT[task.status]}<div className="muted">{time(task.createdAt)}{task.approvedVia ? ` · ${task.approvedVia === 'local' ? '电脑前批准' : '聊天批准'}` : ''}</div></td>
      <td>「{task.label}」请求在「{task.appLabel}」执行：{task.instruction}（最多 {task.maxSteps} 步）
        {task.status === 'queued' && task.remoteApproval === false ? <div className="muted">这个任务只能在这里批准（提交时自动接待没在运行、没设管理员聊天、没设置验证器，或聊天批准已暂停）。</div> : null}
        {task.result ? <div className="muted">结果：{task.result}</div> : null}
        {task.error ? <div className="muted">{task.error}</div> : null}
        {task.status === 'queued' ? <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <Button disabled={acting !== '' || !panel?.localApproval} onClick={() => void act(task.taskId, () => (bridge as any).approveTask?.(task.taskId), `已批准任务 ${task.no}`)}>批准（Touch ID）</Button>
          <Button variant="ghost" disabled={acting !== ''} onClick={() => void act(task.taskId, () => (bridge as any).rejectTask?.(task.taskId), `已拒绝任务 ${task.no}`)}>拒绝</Button>
        </div> : null}
      </td>
    </tr>)}</tbody></table> : <p className="muted">还没有应用任务。</p>}
  </section>;
}
