import React from 'react';
import { Button } from './components';
import { MessagesSquare, ExternalLink, BookOpen } from 'lucide-react';
import { navigate } from './api';

export default function ChannelPlaceholder(_props?: { active?: boolean; onClick?: () => void }) {
  return (
    <div style={{ maxWidth: 720, margin: '64px auto', padding: '40px 24px', textAlign: 'center' }}>
      <div style={{ display: 'inline-flex', padding: 18, borderRadius: '50%', background: 'var(--soft, #f7f7f9)', marginBottom: 20 }}>
        <MessagesSquare size={40} color="var(--p, #6b4fa0)" />
      </div>
      <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 16px', color: 'var(--ink, #111)' }}>
        渠道插件随专业版提供
      </h2>
      <p style={{ color: 'var(--muted, #666)', fontSize: 15, lineHeight: 1.8, margin: '0 auto 28px', maxWidth: 560 }}>
        在聊天窗口里自动读消息、回消息的渠道插件，随专业版提供。
      </p>
      <div style={{ display: 'flex', gap: 14, justifyContent: 'center', alignItems: 'center' }}>
        <Button variant="primary" onClick={() => navigate('knowledge')}>
          <BookOpen size={16} style={{ marginRight: 6 }} /> 进入知识库
        </Button>
        <a
          href="https://kunlungrowth.com/kadadesk"
          target="_blank"
          rel="noopener noreferrer"
          className="button button-secondary"
          style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}
        >
          <ExternalLink size={16} style={{ marginRight: 6 }} /> 访问官网了解专业版
        </a>
      </div>
    </div>
  );
}
