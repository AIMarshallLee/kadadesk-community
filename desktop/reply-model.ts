import { ApiError } from '../server/api-error';
import { CONVERSATION_ROUTING_PROMPT } from '../shared/conversation-intent';

export function chatCompletionsUrl(base: URL | string): URL {
  const url = new URL(typeof base === 'string' ? base : base.href);
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/(?:chat\/completions|responses)$/i, '');
  return new URL('chat/completions', url.href.endsWith('/') ? url.href : `${url.href}/`);
}

export interface ReplyModelCredentials {
  baseUrl: string;
  model: string;
  apiKey?: string;
  temperature?: number;
}

export function replyEndpoint(credentials: { baseUrl: string; model?: string; apiKey?: string }): URL {
  const url = new URL(credentials.baseUrl);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!['https:', 'http:'].includes(url.protocol) || (url.protocol === 'http:' && !local)
    || url.username || url.password || url.search || url.hash || !credentials.model?.trim()) {
    throw new ApiError(400, '模型服务地址或名称无效。');
  }
  if (!local && !credentials.apiKey) {
    throw new ApiError(400, '请先在设置中配置模型 API 密钥。');
  }
  return chatCompletionsUrl(url);
}

export interface ReplyRequest {
  system: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export function createReplyModel(credentials: ReplyModelCredentials, fetchImpl: typeof fetch = fetch) {
  const endpoint = replyEndpoint(credentials);

  const generate = async (request: ReplyRequest): Promise<string> => {
    const messages = request.system
      ? [{ role: 'system' as const, content: request.system }, ...request.messages]
      : request.messages;
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(credentials.apiKey ? { Authorization: `Bearer ${credentials.apiKey}` } : {})
      },
      body: JSON.stringify({
        model: credentials.model,
        temperature: request.temperature ?? credentials.temperature ?? 0.3,
        max_tokens: request.maxTokens ?? 2000,
        messages
      }),
      signal: request.signal
    });
    if (!res.ok) {
      throw new ApiError(res.status, `模型请求失败（HTTP ${res.status}）`);
    }
    const data = await res.json() as any;
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== 'string') {
      throw new ApiError(502, '模型返回格式异常');
    }
    return text.trim();
  };

  return {
    generate,
    classifyConversation: async (payload: string, signal?: AbortSignal): Promise<string> => {
      return generate({
        system: CONVERSATION_ROUTING_PROMPT,
        messages: [{ role: 'user', content: payload }],
        signal
      });
    },
    writeCustomerText: async (system: string, text: string, signal?: AbortSignal): Promise<string> => {
      return generate({
        system,
        messages: [{ role: 'user', content: text }],
        signal
      });
    },
    learn: async (input: { kind: string; sources: any }, signal?: AbortSignal): Promise<string> => {
      return generate({
        system: '你是只读业务知识提炼助手。从样本中提炼事实或 SOP，以中文输出。',
        messages: [{ role: 'user', content: JSON.stringify(input) }],
        signal
      });
    }
  };
}
