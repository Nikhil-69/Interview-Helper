import { useState, useRef, useEffect } from 'react';
import { Settings, X, Minus, Send, Paperclip, Loader2, Camera } from 'lucide-react';
import { initOpenAI, askCopilot } from './openai';
import ReactMarkdown from 'react-markdown';

type Message = {
  role: 'user' | 'assistant';
  content: string;
  image?: string;
};

function App() {
  const [apiKey, setApiKey] = useState(import.meta.env.VITE_OPENAI_API_KEY || '');
  const [context, setContext] = useState(`I am in a coding interview. Help me solve the problem while explaining my thinking clearly to the interviewer.
First help me restate the problem, identify inputs and outputs, clarify constraints, and surface edge cases.If the prompt is ambiguous, suggest the best clarification questions before jumping into code.
Guide me toward a correct approach, then improve it if there is a more efficient algorithm.Explain the tradeoffs between brute force and optimized solutions, including time and space complexity.
When code is needed, provide clean, idiomatic code with meaningful variable names.Include short comments only where they clarify tricky logic.If I already have code on screen, reason about that code directly, point out bugs, and suggest the smallest useful fix.
For data structures and algorithms, pay special attention to boundary conditions, null or empty input, duplicates, ordering, overflow, recursion depth, and off - by - one errors.Help me prepare test cases and dry - run the algorithm.
Keep responses in a live - interview style: concise, spoken, and focused on what I should say or type next.`);

  const [isSetup, setIsSetup] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleSetup = () => {
    if (apiKey.trim()) {
      initOpenAI(apiKey.trim());
      setIsSetup(true);
    }
  };

  const handleMinimize = () => {
    // @ts-ignore
    window.electronAPI?.minimizeApp();
  };

  const handleClose = () => {
    // @ts-ignore
    window.electronAPI?.closeApp();
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleTakeScreenshot = async () => {
    try {
      // @ts-ignore
      const screenshotBase64 = await window.electronAPI?.takeScreenshot();
      if (screenshotBase64) {
        setSelectedImage(screenshotBase64);
      }
    } catch (error) {
      console.error("Failed to take screenshot:", error);
    }
  };

  const handleSubmit = async () => {
    if ((!input.trim() && !selectedImage) || isLoading) return;

    const userMessage: Message = {
      role: 'user',
      content: input,
      image: selectedImage || undefined
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setSelectedImage(null);
    setIsLoading(true);

    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      const response = await askCopilot(context, history, userMessage.content, userMessage.image);

      setMessages(prev => [...prev, { role: 'assistant', content: response }]);
    } catch (error: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${error.message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="glass-container">
      <div className="app-header">
        <h1>Interview Copilot</h1>
        <div className="header-controls">
          <button className="icon-btn" onClick={() => setIsSetup(false)} title="Settings">
            <Settings size={14} />
          </button>
          <button className="icon-btn" onClick={handleMinimize}>
            <Minus size={14} />
          </button>
          <button className="icon-btn" onClick={handleClose}>
            <X size={14} />
          </button>
        </div>
      </div>

      {!isSetup ? (
        <div className="view-container">
          <div className="glass-panel">
            <label className="label">OpenAI API Key</label>
            <input
              type="password"
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>

          <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <label className="label">Pre-meeting Context</label>
            <textarea
              placeholder="Paste job description, your resume highlights, or specific instructions for the AI..."
              value={context}
              onChange={(e) => setContext(e.target.value)}
              style={{ flex: 1, resize: 'none' }}
            />
          </div>

          <button
            className="primary"
            onClick={handleSetup}
            disabled={!apiKey.trim()}
          >
            Start Copilot
          </button>
        </div>
      ) : (
        <div className="view-container" style={{ padding: '8px 12px' }}>
          <div className="chat-messages">
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', marginTop: '20px', color: 'var(--text-secondary)', fontSize: 14 }}>
                Ready to assist. Upload screenshots or ask questions.
              </div>
            )}
            {messages.map((msg, idx) => (
              <div key={idx} className={`message ${msg.role}`}>
                <div className="markdown-body">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
                {msg.image && <img src={msg.image} alt="upload" />}
              </div>
            ))}
            {isLoading && (
              <div className="message assistant" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Loader2 size={16} className="spinner" style={{ animation: 'spin 1s linear infinite' }} />
                Thinking...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {selectedImage && (
              <div style={{ position: 'relative', display: 'inline-block', width: 'fit-content' }}>
                <img src={selectedImage} alt="preview" style={{ height: '60px', borderRadius: '4px', border: '1px solid var(--glass-border)' }} />
                <button
                  onClick={() => setSelectedImage(null)}
                  style={{ position: 'absolute', top: -6, right: -6, background: '#ef4444', color: 'white', border: 'none', borderRadius: '50%', width: 16, height: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <X size={10} />
                </button>
              </div>
            )}

            <div className="input-area">
              <div className="file-input-wrapper">
                <button className="icon-btn" title="Upload Screenshot">
                  <Paperclip size={18} />
                </button>
                <input type="file" accept="image/*" onChange={handleImageUpload} />
              </div>

              <button className="icon-btn" title="Take Screenshot" onClick={handleTakeScreenshot}>
                <Camera size={18} />
              </button>

              <textarea
                placeholder="Ask a question..."
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
              />

              <button
                className="icon-btn"
                style={{ background: (input.trim() || selectedImage) && !isLoading ? 'var(--accent-color)' : 'transparent' }}
                onClick={handleSubmit}
                disabled={(!input.trim() && !selectedImage) || isLoading}
              >
                <Send size={18} color={(input.trim() || selectedImage) && !isLoading ? 'white' : 'var(--text-secondary)'} />
              </button>
            </div>
          </div>
          <style>{`
            @keyframes spin { 100% { transform: rotate(360deg); } }
          `}</style>
        </div>
      )}
    </div>
  );
}

export default App;
