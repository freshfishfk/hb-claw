import React, { useState, KeyboardEvent, useRef, useEffect } from 'react';
import { SendHorizontal } from 'lucide-react';
import { useChatStore } from '../store/chatStore';

interface ChatInputProps {
  onSend: (message: string) => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({ onSend }) => {
  const [text, setText] = useState('');
  const isGenerating = useChatStore((state) => state.isGenerating);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if (text.trim() && !isGenerating) {
      onSend(text.trim());
      setText('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'inherit';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [text]);

  return (
    <div className="relative flex items-end w-full border border-zinc-300 rounded-xl bg-white shadow-sm overflow-hidden focus-within:ring-2 focus-within:ring-orange-500 focus-within:border-transparent transition-all">
      <textarea
        ref={textareaRef}
        className="w-full max-h-[200px] bg-transparent text-zinc-800 placeholder-zinc-400 border-0 focus:ring-0 resize-none p-4 py-3 outline-none"
        placeholder="给 OpenClaw 发送消息..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isGenerating}
        rows={1}
      />
      <button
        onClick={handleSend}
        disabled={!text.trim() || isGenerating}
        className="absolute right-2 bottom-2 p-2 rounded-lg text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:bg-zinc-300 transition-colors"
      >
        <SendHorizontal size={18} />
      </button>
    </div>
  );
};
