import { useState } from 'react';
import { ArrowRight, Bot, BookOpen, Check, ChevronDown, RefreshCw, ShieldCheck, Tag, UserRound, MessageCircleMore, Clock3, FileUp, Layers, PanelRightOpen } from 'lucide-react';
import { Logo } from './components';
import { navigate } from './api';
import './landing.css';

// 产品介绍页（软件内）。品牌：增长飞轮AI（昆仑增长旗下）。对外文案不点名任何具体聊天软件。
// 只写已经做到的能力；规划中的模块单独标注，不当作已上线功能。
const service = [
  { icon: MessageCircleMore, text: '识别你打开的聊天窗口，7×24 自动接待，多轮对话' },
  { icon: Tag, text: '按规则自动给客户打标签，线索一目了然' },
  { icon: Clock3, text: '客户没回复时自动追问，不让客户凉掉' },
  { icon: UserRound, text: '遇到答不了的问题立刻转人工，不丢一个客户' },
  { icon: PanelRightOpen, text: '小浮窗停在屏幕边，接待状态一眼可见，一键暂停 / 继续，不挡聊天窗口' },
];
const knowledge = [
  { icon: FileUp, text: '产品手册、SOP、话术、FAQ 一键导入' },
  { icon: ShieldCheck, text: '导入后先审核再使用，只按你认可的资料回答，不胡编' },
  { icon: Layers, text: '按分类管理，不同产品用不同资料' },
];
const scenes = ['私域咨询量大，人工接待跟不上', '产品复杂，新人培训成本高', '客户问题重复多，大量问题可以自动解决', '想 24 小时接待，但养不起夜班团队'];
const faqs: Array<[string, string]> = [
  ['它会替我自动回复客户吗？', '会。开启自动接待后，咔哒在你打开的聊天窗口里识别新消息并回复；你也可以只让它起草，由你确认后再发。'],
  ['回答会不会乱编？', '咔哒只按你导入并审核过的资料回答。资料里没有、或判断不了的问题，会转给人工处理，不硬答。'],
  ['需要换掉现在用的聊天软件吗？', '不需要。咔哒在你熟悉的聊天窗口里工作，不用迁移客户，也不用换系统。'],
  ['支持哪些电脑？', 'Mac（Apple 芯片）和 Windows 11。安装包已签名，下载后可直接打开。'],
  ['模型费用怎么算？', '软件授权与模型用量分开计费。你可以用自己的模型账号，软件内有接入教程。'],
];

export default function Landing() {
  const [open, setOpen] = useState<number | null>(0);
  const go = () => navigate('desktop-replies');
  return <div className="landing kl">
    <header className="kl-nav">
      <a href="#top" className="kl-logo" aria-label="咔哒工作台"><Logo /><span className="kl-brand-tag">增长飞轮AI</span></a>
      <nav><a href="#modules">两个引擎</a><a href="#loop">飞轮逻辑</a><a href="#scenes">适用场景</a><a href="#pricing">价格</a><a href="#faq">常见问题</a></nav>
      <button className="kl-btn kl-btn-small" onClick={go}>进入工作台 <ArrowRight size={15} /></button>
    </header>
    <main id="top">
      <section className="kl-hero">
        <span className="kl-pill">咔哒工作台 · AI 客服 + 知识库</span>
        <h1>咔哒一下，<em>飞轮转起来。</em></h1>
        <p className="kl-lede">一个工作台，两个引擎，让你的私域自己会跑。<br />AI 客服自动接待，知识库保证答得准。</p>
        <div className="kl-actions"><button className="kl-btn" onClick={go}>开始接待 <ArrowRight size={16} /></button><a className="kl-btn kl-btn-ghost" href="#pricing">查看价格</a></div>
      </section>

      <section className="kl-section" id="modules">
        <div className="kl-head"><span className="kl-kicker">两个核心模块</span><h2>一个工作台，两个引擎</h2></div>
        <div className="kl-cards">
          <article className="kl-card"><div className="kl-card-title"><span className="kl-icon"><Bot size={20} /></span><h3>咔哒 AI 客服</h3></div>
            <ul>{service.map(({ icon: Icon, text }) => <li key={text}><Icon size={16} />{text}</li>)}</ul></article>
          <article className="kl-card"><div className="kl-card-title"><span className="kl-icon"><BookOpen size={20} /></span><h3>咔哒 AI 知识库</h3></div>
            <ul>{knowledge.map(({ icon: Icon, text }) => <li key={text}><Icon size={16} />{text}</li>)}</ul></article>
        </div>
      </section>

      <section className="kl-section kl-loop" id="loop">
        <div className="kl-head"><span className="kl-kicker">产品逻辑</span><h2>知识库喂给客服，客服产出数据，数据反哺知识库</h2></div>
        <div className="kl-steps">
          <div><b>01</b><h4>知识库</h4><p>导入并审核你的业务资料</p></div>
          <RefreshCw className="kl-arrow" size={22} />
          <div><b>02</b><h4>AI 客服</h4><p>按资料自动接待、打标签、追问</p></div>
          <RefreshCw className="kl-arrow" size={22} />
          <div><b>03</b><h4>接待记录</h4><p>转人工的问题，由你补进资料库</p></div>
        </div>
        <p className="kl-note">咔哒一下，飞轮自己转。</p>
      </section>

      <section className="kl-section" id="scenes">
        <div className="kl-head"><span className="kl-kicker">适用场景</span><h2>这些情况，交给咔哒</h2></div>
        <div className="kl-scenes">{scenes.map(s => <div key={s}><Check size={16} />{s}</div>)}</div>
      </section>

      <section className="kl-section" id="pricing">
        <div className="kl-head"><span className="kl-kicker">价格</span><h2>明码标价，买了就能用</h2></div>
        <div className="kl-prices">
          <article><h3>月度专业版</h3><p className="kl-price">¥298<small> / 30 天</small></p><p>适合先跑起来看效果</p></article>
          <article className="kl-featured"><h3>年度旗舰版</h3><p className="kl-price">¥2998<small> / 365 天</small></p><p>长期接待更划算</p></article>
        </div>
        <p className="kl-note">软件授权与模型用量分开计费。购买与激活在工作台右上角的授权入口完成。</p>
      </section>

      <section className="kl-section" id="faq">
        <div className="kl-head"><span className="kl-kicker">常见问题</span><h2>先把边界说清楚</h2></div>
        <div className="kl-faq">{faqs.map(([q, a], i) => <div key={q} className={open === i ? 'open' : ''}><button onClick={() => setOpen(open === i ? null : i)}>{q}<ChevronDown size={16} /></button>{open === i && <p>{a}</p>}</div>)}</div>
      </section>

      <section className="kl-section kl-roadmap">
        <span className="kl-kicker">规划中</span><p>咔哒数据：接待数据已上线（每天接待量、2 分钟内回复率、客户来信时段、知识库缺口）；效果归因、行为分析和咔哒投放（AI 获客）还在规划中，上线后会在这里更新。</p>
      </section>
    </main>
    <footer className="kl-footer">
      <Logo small />
      <p>咔哒工作台是增长飞轮AI（昆仑增长旗下品牌）自研的 AI 客服工具。<br />与昆仑万维、昆仑天工及其关联品牌无隶属、投资或合作关系。</p>
      <p className="kl-site">官网：example.com/kadadesk</p>
    </footer>
  </div>;
}
