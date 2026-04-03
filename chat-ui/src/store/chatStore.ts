import { create } from 'zustand';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ChatState {
  messages: Message[];
  isGenerating: boolean;
  addMessage: (message: Message) => void;
  updateMessage: (id: string, contentDelta: string) => void;
  setGenerating: (generating: boolean) => void;
  clearMessages: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isGenerating: false,
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
  updateMessage: (id, contentDelta) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, content: m.content + contentDelta } : m
      ),
    })),
  setGenerating: (generating) => set({ isGenerating: generating }),
  clearMessages: () => set({ messages: [] }),
}));
