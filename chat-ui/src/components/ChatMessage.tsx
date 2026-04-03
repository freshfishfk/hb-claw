import React from 'react';
import ReactMarkdown from 'react-markdown';
import { User, Bot } from 'lucide-react';
import { Message } from '../store/chatStore';

interface ChatMessageProps {
  message: Message;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const isUser = message.role === 'user';

  return (
    <div
      className={`flex gap-4 p-4 md:p-6 w-full ${
        isUser ? 'bg-zinc-50' : 'bg-white'
      } border-b border-zinc-100`}
    >
      <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-zinc-200 mt-1">
        {isUser ? <User size={18} className="text-zinc-600" /> : <Bot size={18} className="text-orange-500" />}
      </div>
      
      <div className="flex-1 overflow-hidden">
        <div className="font-semibold text-sm text-zinc-800 mb-1">
          {isUser ? '你' : 'OpenClaw'}
        </div>
        
        {isUser ? (
          <div className="text-zinc-700 whitespace-pre-wrap leading-relaxed text-[15px]">
            {message.content}
          </div>
        ) : (
          <div className="prose prose-zinc prose-sm md:prose-base max-w-none text-zinc-700 leading-relaxed">
            <ReactMarkdown>
              {message.content || '...'}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
};
