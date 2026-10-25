import { useState } from 'react';
import { ArrowRight, BookOpen, Check, ChevronDown, RefreshCw, ShieldCheck, Tag, Contact, Sparkles, FileUp, Layers, ExternalLink } from 'lucide-react';
import { Logo } from './components';
import { navigate } from './api';
import './landing.css';

const features = [
  { icon: FileUp, text: '产品手册、SOP、话术、FAQ 一键导入与智能分块' },
  { icon: ShieldCheck, text: '本地安全护栏保障，机密信息与密钥不泄露' },
  { icon: Layers, text: '多来源自动增量更新，支持私有 GitHub 仓库同步' },
  { icon: Contact, text: '客户档案与跟进清单，草稿一键复制，数据离线安全' },
  { icon: Sparkles, text: '内置 MCP 协议，无缝接入 Claude、Codex 等 AI 智能体' },
];

const scenes = [
  '企业私域业务资料庞杂，新人检索与答复培训成本高',
  '需要本地私有化管理客户档案与跟进生命周期',
  '希望利用自己的大模型或本地模型沉淀专属知识资产',
  '需要通过 MCP 协议将内部知识库开放给其他 AI 工具协同',
];

const faqs: Array<[string, string]> = [
  ['咔哒社区版是完全免费的吗？', '是的。咔哒社区版采用开源与免费商用许可，核心功能完全开放，支持使用您自己的模型 API Key 或本地模型。'],
  ['知识库与客户档案会上传到云端吗？', '不会。咔哒采用本地优先架构，所有知识条目与客户档案均保存在您本地设备中，不设云端收集服务。'],
  ['回答会不会胡乱编造？', '咔哒严格依据您导入并审核启用的本地资料进行检索增强生成（RAG），资料中未提及的内容会明确提示未找到。'],
  ['如何实现聊天窗口中的自动读消息与回复？', '在第三方聊天窗口中自动捕获与发送消息的渠道插件属于专业商业版功能，社区版提供草稿复制与开放生态。'],
];

export default function Landing() {
  const [open, setOpen] = useState<number | null>(0);
  const go = () => navigate('knowledge');

  return (
    <div className="landing kl">
      <header className="kl-nav">
        <a href="#top" className="kl-logo" aria-label="咔哒工作台">
          <Logo /><span className="kl-brand-tag">社区版</span>
        </a>
        <nav>
          <a href="#features">核心特性</a>
          <a href="#scenes">适用场景</a>
          <a href="#edition">版本对比</a>
          <a href="#faq">常见问题</a>
        </nav>
        <button className="kl-btn kl-btn-small" onClick={go}>进入工作台 <ArrowRight size={15} /></button>
      </header>

      <main id="top">
        <section className="kl-hero">
          <span className="kl-pill">咔哒 KADAdesk 社区版 · 企业私域的开放 AI 工作台</span>
          <h1>私域知识在本地，<em>模型草稿随时用。</em></h1>
          <p className="kl-lede">
            本地优先存储，零数据外泄；多源自动同步知识库，智能生成客户跟进草稿。
          </p>
          <div className="kl-actions">
            <button className="kl-btn" onClick={go}>开启知识库 <ArrowRight size={16} /></button>
            <a className="kl-btn kl-btn-ghost" href="#edition">了解版本</a>
          </div>
        </section>

        <section className="kl-section" id="features">
          <div className="kl-head">
            <span className="kl-kicker">核心模块</span>
            <h2>本地私域资产与开放协同</h2>
          </div>
          <div className="kl-cards">
            <article className="kl-card">
              <div className="kl-card-title"><span className="kl-icon"><BookOpen size={20} /></span><h3>AI 知识引擎</h3></div>
              <ul>{features.slice(0, 3).map(({ icon: Icon, text }) => <li key={text}><Icon size={16} />{text}</li>)}</ul>
            </article>
            <article className="kl-card">
              <div className="kl-card-title"><span className="kl-icon"><Sparkles size={20} /></span><h3>客户与开放生态</h3></div>
              <ul>{features.slice(3).map(({ icon: Icon, text }) => <li key={text}><Icon size={16} />{text}</li>)}</ul>
            </article>
          </div>
        </section>

        <section className="kl-section" id="scenes">
          <div className="kl-head"><span className="kl-kicker">适用场景</span><h2>这些需求，交给咔哒</h2></div>
          <div className="kl-scenes">{scenes.map(s => <div key={s}><Check size={16} />{s}</div>)}</div>
        </section>

        <section className="kl-section" id="edition">
          <div className="kl-head"><span className="kl-kicker">版本与生态</span><h2>社区版与专业版协同</h2></div>
          <div className="kl-prices">
            <article>
              <h3>社区核心版（开源）</h3>
              <p className="kl-price">免费</p>
              <p>知识库管理、客户档案、草稿生成、MCP 开放协议，完全由本地掌控。</p>
            </article>
            <article className="kl-featured">
              <h3>商业专业版</h3>
              <p className="kl-price">定制合作</p>
              <p>包含桌面渠道自动化插件、集中授权与企业专属私有化定制方案。</p>
            </article>
          </div>
          <p className="kl-note">
            了解更多商业化部署与渠道插件扩展，请访问官网：
            <a href="https://kunlungrowth.com/kadadesk" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--p, #6b4fa0)', marginLeft: 6 }}>
              kunlungrowth.com/kadadesk <ExternalLink size={13} style={{ verticalAlign: 'middle', display: 'inline' }} />
            </a>
          </p>
        </section>

        <section className="kl-section" id="faq">
          <div className="kl-head"><span className="kl-kicker">常见问题</span><h2>先把边界说清楚</h2></div>
          <div className="kl-faq">
            {faqs.map(([q, a], i) => (
              <div key={q} className={open === i ? 'open' : ''}>
                <button onClick={() => setOpen(open === i ? null : i)}>{q}<ChevronDown size={16} /></button>
                {open === i && <p>{a}</p>}
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="kl-footer">
        <Logo small />
        <p>咔哒工作台是增长飞轮AI自研的开放 AI 工作台。<br />与昆仑万维、昆仑天工及其关联品牌无隶属、投资或合作关系。</p>
        <p className="kl-site">
          <a href="https://kunlungrowth.com/kadadesk" target="_blank" rel="noopener noreferrer">kunlungrowth.com/kadadesk</a>
        </p>
      </footer>
    </div>
  );
}
