import { Message } from '../store/chatStore';

const API_URL = 'http://localhost:18789/v1/chat/completions';

export const sendChatMessage = async (
  messages: Message[],
  onChunk: (text: string) => void
) => {
  const payload = {
    model: 'default',
    messages: messages.map(({ role, content }) => ({ role, content })),
    stream: true,
  };

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let done = false;

    while (!done) {
      const { value, done: readerDone } = await reader.read();
      done = readerDone;
      if (value) {
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ') && line.trim() !== 'data: [DONE]') {
            try {
              const data = JSON.parse(line.slice(6));
              const content = data.choices?.[0]?.delta?.content;
              if (content) {
                onChunk(content);
              }
            } catch (e) {
              console.error('Failed to parse SSE line', e);
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('Error sending message:', error);
    onChunk('\n\n**连接错误**: 无法连接到 OpenClaw Gateway。请确保已通过 `openclaw gateway --port 18789` 启动服务。');
  }
};
