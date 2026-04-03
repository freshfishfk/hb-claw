import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { TerminalSquare, Zap, Cpu, SendHorizontal, Trash2, Menu, X } from 'lucide-react';
import { useWsStore } from '../store/wsStore';
import { wsManager } from '../lib/websocket';

const Home: React.FC = () => {
  const { status, skills, messages, isGenerating, clearMessages } = useWsStore();
  const [input, setInput] = useState('');
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    wsManager.connect();
    return () => wsManager.disconnect();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isGenerating]);

  const handleSend = () => {
    if (input.trim() && !isGenerating) {
      wsManager.sendChat(input.trim());
      setInput('');
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'online': return 'text-primary bg-primary/20 shadow-[0_0_10px_#00ff66]';
      case 'connecting': return 'text-yellow-500 bg-yellow-500/20 animate-pulse';
      case 'reconnecting': return 'text-orange-500 bg-orange-500/20 animate-pulse';
      case 'offline': return 'text-red-500 bg-red-500/20';
      default: return 'text-zinc-500 bg-zinc-800';
    }
  };

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden font-mono selection:bg-primary/30">
      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-20 md:hidden" 
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Skills Sidebar */}
      <aside className={`fixed md:static inset-y-0 left-0 w-64 bg-panel terminal-border border-r z-30 transform transition-transform duration-300 ease-in-out ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'} flex flex-col`}>
        <div className="h-14 flex items-center justify-between px-4 border-b border-border">
          <div className="flex items-center gap-2 text-primary glow-text font-bold tracking-wider">
            <Cpu size={18} />
            <span>OC.SYS_LINK</span>
          </div>
          <button className="md:hidden text-zinc-400 hover:text-white" onClick={() => setSidebarOpen(false)}>
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-none p-4">
          <div className="text-xs text-zinc-500 mb-4 tracking-widest uppercase flex items-center gap-2">
            <div className="w-2 h-[1px] bg-zinc-500"></div>
            ACTIVE_SKILLS
            <div className="flex-1 h-[1px] bg-zinc-800"></div>
          </div>
          
          {skills.length === 0 ? (
            <div className="text-zinc-600 text-sm italic">
              [No skills detected]
            </div>
          ) : (
            <div className="space-y-3">
              {skills.map((s, idx) => (
                <div key={idx} className="p-3 border border-border bg-black/50 hover:border-primary/50 transition-colors group cursor-crosshair">
                  <div className="text-secondary glow-text-secondary text-sm font-semibold truncate mb-1">
                    {s.name || s.id}
                  </div>
                  {s.description && (
                    <div className="text-xs text-zinc-500 line-clamp-2 leading-relaxed group-hover:text-zinc-400 transition-colors">
                      {s.description}
                    </div>
                  )}
                  <div className="mt-2 text-[10px] text-zinc-600 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary/70"></span>
                    Ready
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-background relative">
        {/* Header */}
        <header className="h-14 flex-none border-b border-border flex items-center justify-between px-4 sticky top-0 bg-background/80 backdrop-blur z-10">
          <div className="flex items-center gap-3">
            <button className="md:hidden text-zinc-400 hover:text-primary" onClick={() => setSidebarOpen(true)}>
              <Menu size={20} />
            </button>
            <div className="flex items-center gap-2 px-2 py-1 rounded-sm bg-black border border-border text-xs">
              <div className={`w-2 h-2 rounded-full ${getStatusColor()}`}></div>
              <span className="uppercase tracking-wider text-zinc-300">
                {status}
              </span>
            </div>
          </div>
          
          <button
            onClick={clearMessages}
            className="text-xs text-zinc-500 hover:text-red-500 uppercase tracking-widest flex items-center gap-1 transition-colors"
          >
            <Trash2 size={14} />
            <span className="hidden sm:inline">PURGE_MEM</span>
          </button>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 scrollbar-none">
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full min-h-[50vh] text-center opacity-50 select-none">
                <TerminalSquare size={48} className="text-zinc-700 mb-4" />
                <h2 className="text-xl tracking-widest text-zinc-500 uppercase">SYSTEM_READY</h2>
                <p className="text-xs text-zinc-600 mt-2">Awaiting standard input...</p>
              </div>
            ) : (
              messages.map((msg, idx) => (
                <div key={idx} className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role !== 'user' && (
                    <div className="flex-shrink-0 mt-1 text-primary">
                      <Zap size={18} />
                    </div>
                  )}
                  <div className={`max-w-[85%] ${msg.role === 'user' ? 'bg-panel border border-border text-zinc-300 p-3 rounded-sm' : 'text-zinc-400'}`}>
                    {msg.role === 'user' ? (
                      <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
                    ) : (
                      <div className="prose prose-invert prose-sm md:prose-base max-w-none font-sans leading-relaxed">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
            {isGenerating && (
              <div className="flex gap-4 justify-start">
                <div className="flex-shrink-0 mt-1 text-primary animate-pulse">
                  <Zap size={18} />
                </div>
                <div className="text-primary glow-text text-sm animate-pulse">
                  _PROCESSING...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Area */}
        <footer className="p-4 bg-background border-t border-border flex-none">
          <div className="max-w-3xl mx-auto relative">
            <div className="absolute left-4 top-4 text-primary glow-text">
              {'>'}
            </div>
            <textarea
              className="w-full bg-panel border border-border text-zinc-200 placeholder-zinc-600 p-4 pl-10 resize-none outline-none focus:border-primary/50 transition-colors font-mono text-sm"
              rows={2}
              placeholder="Enter command or message..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              disabled={isGenerating || status !== 'online'}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isGenerating || status !== 'online'}
              className="absolute right-3 bottom-3 p-2 text-zinc-500 hover:text-primary disabled:opacity-30 transition-colors"
            >
              <SendHorizontal size={18} />
            </button>
          </div>
        </footer>
      </main>
    </div>
  );
};

export default Home;
