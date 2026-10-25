const messages = {
  closed: '原生通道已关闭', aborted: '原生通道已取消', exited: '原生通道已退出',
  timeout: '原生通道请求超时', write: '原生通道写入失败', stderr: '原生通道发生错误',
  spawn: '原生通道无法启动', overflow: '原生通道输出超限', response: '原生通道响应无效',
} as const;

/** Only the native transport creates these errors; never copy stderr/request data. */
export class NativeChannelError extends Error {
  constructor(readonly code: keyof typeof messages) {
    super(messages[code]); this.name = 'NativeChannelError';
  }
}

/** Eligible only while inspecting before input, with a freshly recreated surface. */
export function transientNativeReadFailure(error: unknown): boolean {
  return error instanceof NativeChannelError && ['exited', 'timeout', 'write'].includes(error.code);
}
