import {Button} from './components';
import './chat-experience.css';
import {chatExperiences,type ChatExperience} from '../shared/chat-experience';
export default function ChatExperienceField({value,onChange,disabled=false,onExample}:{value?:ChatExperience;onChange:(value:ChatExperience|undefined)=>void;disabled?:boolean;onExample?:(text:string)=>void}){
 const selected=chatExperiences.find(p=>p.id===value);
 return <section className="chat-experience" aria-label="聊天体验场景"><label>回复场景<select aria-label="回复场景" value={value??''} disabled={disabled} onChange={e=>onChange(e.target.value as ChatExperience||undefined)}><option value="">自动识别 · 按聊天内容判断业务接待或日常聊天</option>{chatExperiences.map(p=><option key={p.id} value={p.id}>手动指定：{p.label}聊天 · {p.description}</option>)}</select></label>
 <p>{selected?`${selected.label}聊天无需导入话术或知识，使用当前会话上文自然回复。业务资料和工作流程在本场景暂停使用，切回业务接待后仍保留。`:'默认自动识别：咨询业务时使用知识和工作流程，日常聊天时按对话判断家人、朋友或恋人语气；无需手动切换。也可手动指定一个场景。'}</p>
 {selected&&<p>场景只决定聊天语气，不会识别或添加联系人。真实聊天请指定已核实的单聊对象，所选对象共用当前场景；仍需配置模型和窗口权限。选择场景不会启动监听或发送。</p>}
 {selected&&onExample&&<div className="settings-actions">{selected.examples.map(example=><Button variant="secondary" type="button" key={example} disabled={disabled} onClick={()=>onExample(example)}>{example}</Button>)}</div>}
 </section>;
}
