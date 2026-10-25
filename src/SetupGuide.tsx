import React from 'react';
import type { PageProps } from './App';
import { Button } from './components';
import { BookOpen, KeyRound, Sparkles, Contact, ArrowRight, CheckCircle2, ShieldCheck } from 'lucide-react';
import './setup-guide.css';

export const setupHelp: Record<string, string> = {
  'settings/reply': '填写你的文字模型服务商地址、模型名称与 API 密钥。支持 DeepSeek、OpenAI、Claude 或本地 Ollama/vLLM。',
  'knowledge/import': '选择你的产品说明、FAQ 或资料文档（支持 Markdown、TXT、DOCX、PDF、ZIP），生成预览后核对并启用。',
  knowledge: '在知识库中输入客户常问的问题，对照资料进行试答演练。试答完全在本地进行，不会对外发送消息。',
  customers: '管理私域客户档案、导入联系人分组，并自动基于知识库生成跟进草稿，供人工复制发送。',
  open: '开放 MCP 协议接入，允许各类 AI 客户端（如 Claude Desktop 等）安全调用本地知识库。'
};

export default function SetupGuide({ state, onOpen }: PageProps & { onOpen(route: string): void }) {
  const hasModel = !!state.provider.hasKey || ['localhost', '127.0.0.1'].some(h => state.provider.baseUrl.includes(h));
  const hasKnowledge = state.knowledge.some(k => k.enabled && k.reviewStatus !== 'pending' && !k.id.startsWith('knowledge_demo_'));
  const hasTasks = state.tasks.length > 0;

  const steps = [
    {
      id: 'model',
      title: '第一步：配置回复生成模型',
      desc: '在设置中配置你的 API 密钥，支持主流云端大模型或本地运行的 Ollama。',
      done: hasModel,
      action: '前往设置模型',
      route: 'settings'
    },
    {
      id: 'knowledge',
      title: '第二步：导入企业专属知识',
      desc: '支持批量导入本地文档、常见问答或产品手册，经 AI 自动分段整理与人工审核后启用。',
      done: hasKnowledge,
      action: '导入与管理知识',
      route: 'knowledge'
    },
    {
      id: 'practice',
      title: '第三步：知识问答试答与草稿生成',
      desc: '使用真实业务问题测试知识库回复效果，验证依据来源与准确性。',
      done: hasTasks,
      action: '开始试答测试',
      route: 'knowledge'
    },
    {
      id: 'customers',
      title: '第四步：客户档案与跟进清单',
      desc: '沉淀客户偏好，自动生成个性化跟进草稿，供人工复制手动发送。',
      done: (state.leads?.length ?? 0) > 0,
      action: '查看客户档案',
      route: 'customers'
    }
  ];

  return (
    <div style={{ maxWidth: 840, margin: '24px auto', padding: '0 16px' }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px', color: 'var(--ink, #111)' }}>
          咔哒社区版 · 快速上手指南
        </h1>
        <p style={{ color: 'var(--muted, #666)', fontSize: 15, margin: 0, lineHeight: 1.6 }}>
          四步完成本地工作台配置，构建安全、私密的专属 AI 业务助手。
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {steps.map((step, idx) => (
          <div
            key={step.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '20px 24px',
              borderRadius: 12,
              background: '#fff',
              border: step.done ? '1px solid #e2e8f0' : '1px solid #cbd5e1',
              boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
            }}
          >
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
              <div style={{ marginTop: 2 }}>
                {step.done ? (
                  <CheckCircle2 size={22} color="var(--ok, #16a34a)" />
                ) : (
                  <span
                    style={{
                      display: 'inline-flex',
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: 'var(--soft, #f1f5f9)',
                      color: 'var(--muted, #64748b)',
                      fontSize: 13,
                      fontWeight: 700,
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    {idx + 1}
                  </span>
                )}
              </div>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 6px', color: 'var(--ink, #111)' }}>
                  {step.title}
                </h3>
                <p style={{ fontSize: 14, color: 'var(--muted, #64748b)', margin: 0, lineHeight: 1.5 }}>
                  {step.desc}
                </p>
              </div>
            </div>
            <Button variant={step.done ? 'secondary' : 'primary'} onClick={() => onOpen(step.route)}>
              {step.action} <ArrowRight size={14} style={{ marginLeft: 4 }} />
            </Button>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 32,
          padding: '16px 20px',
          background: 'var(--soft, #f8fafc)',
          borderRadius: 8,
          border: '1px solid #e2e8f0',
          display: 'flex',
          gap: 12,
          alignItems: 'center'
        }}
      >
        <ShieldCheck size={20} color="var(--p, #6b4fa0)" />
        <span style={{ fontSize: 14, color: '#475569' }}>
          数据本地优先：所有文档、知识库与客户信息均存储在本地设备中，未经明确配置绝不上传第三方服务器。
        </span>
      </div>
    </div>
  );
}
