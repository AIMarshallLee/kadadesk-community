import React from 'react';
import { Button } from './components';
import { MessagesSquare, BookOpen, Sparkles } from 'lucide-react';
import { navigate } from './api';

export default function ChannelPlaceholder(_props?: { active?: boolean; onClick?: () => void }) {
  return (
    <div style={{ maxWidth: 720, margin: '48px auto', padding: '32px 24px', textAlign: 'center' }}>
      <div style={{ display: 'inline-flex', padding: 16, borderRadius: '50%', background: 'var(--soft, #f7f7f9)', marginBottom: 16 }}>
        <MessagesSquare size={36} color="var(--p, #6b4fa0)" />
      </div>
      <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 12px', color: 'var(--ink, #111)' }}>
        渠道插件随专业版提供
      </h2>
      <p style={{ color: 'var(--muted, #666)', fontSize: 15, lineHeight: 1.7, margin: '0 0 24px' }}>
        咔哒社区版包含完整的本地优先 AI 工作台：知识库导入整理与试答、客户档案与跟进清单、开放 MCP 协议及本地诊断。<br />
        在真实聊天窗口中自动识别客户消息并自动发送的渠道自动化插件，属于商业版本功能。
      </p>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
        <Button variant="primary" onClick={() => navigate('knowledge')}>
          <BookOpen size={16} style={{ marginRight: 6 }} /> 进入知识库
        </Button>
        <Button variant="secondary" onClick={() => navigate('plugins')}>
          <Sparkles size={16} style={{ marginRight: 6 }} /> 查看开放插件
        </Button>
      </div>
    </div>
  );
}
