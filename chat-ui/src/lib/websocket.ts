import { v4 as uuidv4 } from 'uuid';
import { useWsStore } from '../store/wsStore';

const WS_URL = 'ws://localhost:18789';

class WebSocketManager {
  private ws: WebSocket | null = null;
  private pendingRequests: Map<string, { resolve: Function; reject: Function }> = new Map();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isIntentionalClose = false;

  public connect() {
    if (this.ws?.readyState === WebSocket.OPEN) {return;}
    
    this.isIntentionalClose = false;
    useWsStore.getState().setStatus('connecting');

    try {
      this.ws = new WebSocket(WS_URL);

      this.ws.onopen = () => {
        useWsStore.getState().setStatus('online');
        this.handshake();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (e) {
          console.error('WS Parse Error:', e);
        }
      };

      this.ws.onclose = () => {
        if (!this.isIntentionalClose) {
          useWsStore.getState().setStatus('offline');
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket Error:', error);
        this.ws?.close();
      };
    } catch (e) {
      console.error('Failed to create WebSocket:', e);
      this.scheduleReconnect();
    }
  }

  public disconnect() {
    this.isIntentionalClose = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    useWsStore.getState().setStatus('offline');
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) {clearTimeout(this.reconnectTimer);}
    useWsStore.getState().setStatus('reconnecting');
    this.reconnectTimer = setTimeout(() => this.connect(), 3000);
  }

  private async handshake() {
    try {
      await this.request('connect', {});
      // Connection fully established, now fetch skills
      this.fetchSkills();
    } catch (e) {
      console.error('Handshake failed:', e);
      this.ws?.close();
    }
  }

  public async fetchSkills() {
    try {
      // OpenClaw might use tools.catalog or skills.status. Let's try skills.status
      const res = await this.request('skills.status', {});
      if (res && res.result) {
        useWsStore.getState().setSkills(res.result.skills || res.result || []);
      }
    } catch (e) {
      console.error('Failed to fetch skills:', e);
    }
  }

  public sendChat(message: string) {
    const sessionKey = 'web-client-' + uuidv4().substring(0, 8);
    const idempotencyKey = uuidv4();
    const id = uuidv4();

    // Add local user message
    useWsStore.getState().addMessage({
      id: id,
      role: 'user',
      content: message,
    });

    const req = {
      type: 'req',
      id: id,
      method: 'chat.send',
      params: {
        sessionKey,
        message,
        idempotencyKey,
      }
    };

    if (this.ws?.readyState === WebSocket.OPEN) {
      useWsStore.getState().setGenerating(true);
      this.ws.send(JSON.stringify(req));
    } else {
      console.error('WS not open');
    }
  }

  private request(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState !== WebSocket.OPEN) {
        return reject(new Error('WebSocket is not connected'));
      }

      const id = uuidv4();
      this.pendingRequests.set(id, { resolve, reject });

      const req = {
        type: 'req',
        id,
        method,
        params,
      };

      this.ws.send(JSON.stringify(req));

      // Timeout for requests
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 10000);
    });
  }

  private handleMessage(data: any) {
    // Handle RPC Responses
    if (data.type === 'res') {
      const pending = this.pendingRequests.get(data.id);
      if (pending) {
        this.pendingRequests.delete(data.id);
        if (data.error) {pending.reject(data.error);}
        else {pending.resolve(data);}
      }
      return;
    }

    // Handle Server Events (Broadcasts)
    if (data.type === 'event' || data.event) {
      const eventName = data.event || data.type;
      
      if (eventName === 'chat.delta') {
        const payload = data.payload || data.data;
        if (payload?.message?.content) {
          useWsStore.getState().appendAssistantMessage(data.id || 'assistant-current', payload.message.content);
        }
      } 
      else if (eventName === 'chat.final') {
        useWsStore.getState().setGenerating(false);
      }
    }
  }
}

export const wsManager = new WebSocketManager();