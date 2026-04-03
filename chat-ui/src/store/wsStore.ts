import { create } from 'zustand';

export type WSStatus = 'connecting' | 'online' | 'offline' | 'reconnecting';

export interface Skill {
  id: string;
  name: string;
  description?: string;
  status?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface WsState {
  status: WSStatus;
  skills: Skill[];
  messages: Message[];
  isGenerating: boolean;
  
  setStatus: (status: WSStatus) => void;
  setSkills: (skills: Skill[]) => void;
  addMessage: (message: Message) => void;
  appendAssistantMessage: (id: string, content: string) => void;
  setGenerating: (generating: boolean) => void;
  clearMessages: () => void;
}

export const useWsStore = create<WsState>((set) => ({
  status: 'offline',
  skills: [],
  messages: [],
  isGenerating: false,

  setStatus: (status) => set({ status }),
  
  setSkills: (skills) => set({ skills }),

  addMessage: (message) => set((state) => ({ 
    messages: [...state.messages, message] 
  })),

  appendAssistantMessage: (id, content) => set((state) => {
    const existingIdx = state.messages.findIndex(m => m.id === id);
    if (existingIdx >= 0) {
      const newMessages = [...state.messages];
      newMessages[existingIdx].content += content;
      return { messages: newMessages };
    } else {
      return {
        messages: [...state.messages, { id, role: 'assistant', content }]
      };
    }
  }),

  setGenerating: (isGenerating) => set({ isGenerating }),

  clearMessages: () => set({ messages: [] }),
}));
