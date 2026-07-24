import { useState, useRef, useEffect } from 'react';
import { Settings, X, Minus, Send, Paperclip, Loader2, Camera, ShieldCheck, ShieldAlert, EyeOff, MonitorUp, AlertTriangle, Coins, LogOut } from 'lucide-react';
import { login, fetchMe, askCopilot, compressImage, getToken, clearToken, ApiError, type User } from './api';
import ReactMarkdown from 'react-markdown';

type Message = {
  role: 'user' | 'assistant';
  content: string;
  image?: string;
};

type CaptureStatus = { platform: string; protected: boolean; note: string };
type CaptureScan = { active: boolean; apps: string[] };
type View = 'login' | 'setup' | 'chat';

declare global {
  interface Window {
    electronAPI?: {
      getDesktopSources: () => Promise<unknown>;
      takeScreenshot: () => Promise<string>;
      closeApp: () => void;
      minimizeApp: () => void;
      getCaptureStatus: () => Promise<CaptureStatus>;
      scanForCaptureApps: () => Promise<CaptureScan>;
      toggleStealth: (forceState?: boolean) => Promise<boolean>;
      moveToNextDisplay: () => Promise<{ id: number; label: string } | null>;
      onStealthChanged: (cb: (visible: boolean) => void) => () => void;
    };
  }
}

function App() {
  const [view, setView] = useState<View>('login');
  const [user, setUser] = useState<User | null>(null);
  const [credits, setCredits] = useState<number>(0);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const [context, setContext] = useState(`I am in a coding interview. Help me solve the problem while explaining my thinking clearly to the interviewer.
First help me restate the problem, identify inputs and outputs, clarify constraints, and surface edge cases.If the prompt is ambiguous, suggest the best clarification questions before jumping into code.
Guide me toward a correct approach, then improve it if there is a more efficient algorithm.Explain the tradeoffs between brute force and optimized solutions, including time and space complexity.
When code is needed, provide clean, idiomatic code with meaningful variable names.Include short comments only where they clarify tricky logic.If I already have code on screen, reason about that code directly, point out bugs, and suggest the smallest useful fix.
For data structures and algorithms, pay special attention to boundary conditions, null or empty input, duplicates, ordering, overflow, recursion depth, and off - by - one errors.Help me prepare test cases and dry - run the algorithm.
Keep responses in a live - interview style: concise, spoken, and focused on what I should say or type next.`);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus | null>(null);
  const [captureScan, setCaptureScan] = useState<CaptureScan>({ active: false, apps: [] });
  const [dismissedBanner, setDismissedBanner] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Restore session if we still have a valid token.
  useEffect(() => {
    if (!getToken()) return;
    fetchMe()
      .then((u) => {
        setUser(u);
        setCredits(u.credits_balance);
        setView('setup');
      })
      .catch(() => clearToken());
  }, []);

  useEffect(() => {
    window.electronAPI?.getCaptureStatus().then(setCaptureStatus);
    const runScan = () => window.electronAPI?.scanForCaptureApps().then(setCaptureScan);
    runScan();
    const id = setInterval(runScan, 5000);
    return () => clearInterval(id);
  }, []);

  const handleMoveDisplay = async () => {
    const res = await window.electronAPI?.moveToNextDisplay();
    if (!res) {
      // Only one display, or Wayland blocked the move.
      alert('No other display available to move to (or your Wayland session blocks window moves — drag the window manually, or run under X11).');
    }
  };

  const isExposed = captureStatus ? !captureStatus.protected : false;
  const showBanner = !dismissedBanner && (isExposed || captureScan.active);

  const handleLogin = async () => {
    if (!email.trim() || !password) return;
    setAuthError('');
    setAuthLoading(true);
    try {
      const u = await login(email.trim(), password);
      setUser(u);
      setCredits(u.credits_balance);
      setPassword('');
      setView('setup');
    } catch (error: any) {
      setAuthError(error.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    clearToken();
    setUser(null);
    setMessages([]);
    setView('login');
  };

  const handleMinimize = () => {
    window.electronAPI?.minimizeApp();
  };

  const handleClose = () => {
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
        compressImage(reader.result as string)
          .then(setSelectedImage)
          .catch(() => setSelectedImage(reader.result as string));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleTakeScreenshot = async () => {
    try {
      const screenshotBase64 = await window.electronAPI?.takeScreenshot();
      if (screenshotBase64) {
        setSelectedImage(await compressImage(screenshotBase64));
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
      const res = await askCopilot(context, history, userMessage.content, userMessage.image);
      setCredits(res.credits);
      setMessages(prev => [...prev, { role: 'assistant', content: res.answer }]);
    } catch (error: any) {
      if (error instanceof ApiError && error.status === 401) {
        handleLogout();
        return;
      }
      if (error instanceof ApiError && error.credits !== undefined) {
        setCredits(error.credits);
      }
      const msg = error instanceof ApiError && error.status === 402
        ? 'You are out of credits. Please purchase more to continue.'
        : `Error: ${error.message}`;
      setMessages(prev => [...prev, { role: 'assistant', content: msg }]);
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
          {user && (
            <span className="credits-pill" title="Available credits">
              <Coins size={12} />
              {credits}
            </span>
          )}
          {captureStatus && (
            <span
              className={`shield-pill ${captureStatus.protected ? 'protected' : 'exposed'}`}
              title={captureStatus.note}
            >
              {captureStatus.protected ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
              {captureStatus.protected ? 'Hidden' : 'Exposed'}
            </span>
          )}
          <button className="icon-btn" onClick={() => window.electronAPI?.toggleStealth(false)} title="Hide overlay (Ctrl/Cmd+Shift+Space)">
            <EyeOff size={14} />
          </button>
          {user && (
            <>
              <button className="icon-btn" onClick={() => setView('setup')} title="Settings">
                <Settings size={14} />
              </button>
              <button className="icon-btn" onClick={handleLogout} title="Log out">
                <LogOut size={14} />
              </button>
            </>
          )}
          <button className="icon-btn" onClick={handleMinimize}>
            <Minus size={14} />
          </button>
          <button className="icon-btn" onClick={handleClose}>
            <X size={14} />
          </button>
        </div>
      </div>

      {view === 'login' && (
        <div className="view-container">
          <div className="glass-panel">
            <label className="label">Email</label>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="glass-panel">
            <label className="label">Password</label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            />
          </div>
          {authError && <div className="auth-error">{authError}</div>}
          <button
            className="primary"
            onClick={handleLogin}
            disabled={!email.trim() || !password || authLoading}
          >
            {authLoading ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="auth-hint">
            Don't have an account? Create one on the website, then sign in here.
          </p>
        </div>
      )}

      {view === 'setup' && (
        <div className="view-container">
          <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <label className="label">Pre-meeting Context</label>
            <textarea
              placeholder="Paste job description, your resume highlights, or specific instructions for the AI..."
              value={context}
              onChange={(e) => setContext(e.target.value)}
              style={{ flex: 1, resize: 'none' }}
            />
          </div>

          <button className="primary" onClick={() => setView('chat')}>
            Start Copilot
          </button>
        </div>
      )}

      {view === 'chat' && (
        <div className="view-container" style={{ padding: '8px 12px' }}>
          {showBanner && (
            <div className={`capture-banner ${isExposed ? '' : 'warn'}`}>
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ flex: 1 }}>
                {isExposed ? (
                  <>
                    On Linux the overlay <strong>is visible in full-screen shares</strong> — no OS flag can hide it.
                    {captureScan.active && <> Detected: <strong>{captureScan.apps.join(', ')}</strong>.</>}
                    {' '}Use <kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd> to hide, or move it to an unshared monitor.
                  </>
                ) : (
                  <>Screen recording/conferencing app detected: <strong>{captureScan.apps.join(', ')}</strong>. Your overlay is hidden from capture on this OS.</>
                )}
                <button
                  onClick={() => setDismissedBanner(true)}
                  style={{ background: 'none', border: 'none', color: 'inherit', textDecoration: 'underline', cursor: 'pointer', display: 'block', marginTop: 4, fontSize: 11, padding: 0 }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
          {isExposed && (
            <div className="stealth-actions">
              <button onClick={() => window.electronAPI?.toggleStealth(false)} title="Ctrl/Cmd+Shift+Space">
                <EyeOff size={14} /> Panic hide
              </button>
              <button onClick={handleMoveDisplay} title="Ctrl/Cmd+Shift+M">
                <MonitorUp size={14} /> Move display
              </button>
            </div>
          )}
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
