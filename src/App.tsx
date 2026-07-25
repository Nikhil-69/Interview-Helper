import { useState, useRef, useEffect } from 'react';
import { Settings, SlidersHorizontal, Sparkles, X, Minus, Send, Camera, ShieldCheck, ShieldAlert, EyeOff, MonitorUp, AlertTriangle, AlertCircle, Coins, LogOut, Download, Mail, Lock, MessageSquare, MoreVertical, User as UserIcon, Zap, ExternalLink, RotateCcw, Globe } from 'lucide-react';
import { login, register, fetchMe, fetchPackages, createOrder, fetchOrder, payOrderMock, askCopilot, compressImage, getToken, clearToken, fetchPromptModes, DEFAULT_PROMPT_MODES, ApiError, type User, type CreditPackage, type PromptMode } from './api';
import ReactMarkdown from 'react-markdown';
import SettingsPanel from './components/SettingsPanel';
import { applySettings, loadSettings, saveSettings, NORMAL_WINDOW_SIZE, COMPACT_WINDOW_SIZE, type AppSettings } from './settings';

type Message = {
  role: 'user' | 'assistant';
  content: string;
  images?: string[];
};

// Compressed JPEGs run a few hundred KB each; cap the batch so the request
// stays under the server's ~4.5 MB body limit.
const MAX_IMAGES = 4;

const isMac = navigator.platform.toUpperCase().includes('MAC');

type CaptureStatus = { platform: string; supported: boolean; protected: boolean; note: string };
type CaptureScan = { active: boolean; apps: string[] };
type UpdateStatus = {
  state: 'downloading' | 'ready' | 'error';
  version?: string;
  percent?: number;
  message?: string;
};
type View = 'loading' | 'login' | 'register' | 'plans' | 'awaiting-payment' | 'setup' | 'chat';

declare global {
  interface Window {
    electronAPI?: {
      getDesktopSources: () => Promise<unknown>;
      takeScreenshot: () => Promise<string>;
      closeApp: () => void;
      minimizeApp: () => void;
      getCaptureStatus: () => Promise<CaptureStatus>;
      setContentProtection: (enabled: boolean) => Promise<CaptureStatus>;
      scanForCaptureApps: () => Promise<CaptureScan>;
      toggleStealth: (forceState?: boolean) => Promise<boolean>;
      moveToNextDisplay: () => Promise<{ id: number; label: string } | null>;
      setCompactMode: (compact: boolean) => Promise<boolean>;
      setCollapsed: (collapsed: boolean, expandedSize: { width: number; height: number }) => Promise<boolean>;
      openExternal: (url: string) => Promise<boolean>;
      onStealthChanged: (cb: (visible: boolean) => void) => () => void;
      getVersion: () => Promise<string>;
      checkForUpdates: () => Promise<string | null>;
      installUpdate: () => void;
      onUpdateStatus: (cb: (status: UpdateStatus) => void) => () => void;
    };
  }
}

function App() {
  // A saved token means we're about to verify the session — show a loading
  // state instead of the login form so it doesn't flash before swapping to
  // 'setup'. No token means there's nothing to restore, so go straight to login.
  const [view, setView] = useState<View>(() => (getToken() ? 'loading' : 'login'));
  const [user, setUser] = useState<User | null>(null);
  const [credits, setCredits] = useState<number>(0);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const [packages, setPackages] = useState<CreditPackage[] | null>(null);
  const [plansError, setPlansError] = useState('');
  const [orderingId, setOrderingId] = useState<string | null>(null);
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [pendingPaymentUrl, setPendingPaymentUrl] = useState<string | null>(null);
  // Where to land after buying (or backing out of) credits. Null = fresh
  // signup flow, which continues to 'setup'.
  const [plansReturnView, setPlansReturnView] = useState<View | null>(null);

  // Prompt mode replaces the old hardcoded pre-meeting prompt: the server owns
  // the per-mode system prompts; `context` is now optional extra context (or
  // the prompt itself when mode is 'custom').
  const [promptModes, setPromptModes] = useState<PromptMode[]>(DEFAULT_PROMPT_MODES);
  const [promptMode, setPromptMode] = useState('coding-interview');
  const [context, setContext] = useState('');
  // Kimi runs the search server-side; only works on search-capable models
  // (the server silently skips it otherwise).
  const [webSearch, setWebSearch] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus | null>(null);
  const [captureScan, setCaptureScan] = useState<CaptureScan>({ active: false, apps: [] });
  const [dismissedBanner, setDismissedBanner] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [appVersion, setAppVersion] = useState('');
  const [checkResult, setCheckResult] = useState<'idle' | 'checking' | 'latest' | 'failed'>('idle');
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [showSettings, setShowSettings] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Apply persisted settings on launch (CSS vars + main-process window state).
  useEffect(() => {
    applySettings(settings);
    window.electronAPI?.setCompactMode(settings.compact);
    window.electronAPI?.setContentProtection(settings.hideFromScreenShare).then(setCaptureStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh the prompt-mode catalog from the server once signed in; the
  // bundled DEFAULT_PROMPT_MODES list keeps the picker working offline.
  useEffect(() => {
    if (!user) return;
    fetchPromptModes().then(setPromptModes).catch(() => {});
  }, [user]);

  const updateSettings = (partial: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      applySettings(next);
      saveSettings(next);
      if (partial.compact !== undefined) {
        window.electronAPI?.setCompactMode(partial.compact);
      }
      if (partial.hideFromScreenShare !== undefined) {
        window.electronAPI?.setContentProtection(partial.hideFromScreenShare).then(setCaptureStatus);
      }
      return next;
    });
  };

  useEffect(() => {
    window.electronAPI?.getVersion().then(setAppVersion).catch(() => {});
    const unsubscribe = window.electronAPI?.onUpdateStatus((status) => {
      // Errors are non-fatal (app keeps working); don't nag the user with them.
      setUpdateStatus(status.state === 'error' ? null : status);
    });
    return unsubscribe;
  }, []);

  const handleCheckForUpdates = async () => {
    setCheckResult('checking');
    try {
      const version = await window.electronAPI?.checkForUpdates();
      // A newer version triggers the download banner via onUpdateStatus.
      setCheckResult(version ? 'idle' : 'latest');
    } catch {
      setCheckResult('failed');
    }
  };

  // Restore session if we still have a valid token.
  useEffect(() => {
    if (!getToken()) return;
    fetchMe()
      .then((u) => {
        setUser(u);
        setCredits(u.credits_balance);
        setView('setup');
      })
      .catch(() => {
        clearToken();
        setView('login');
      });
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

  const handleToggleCollapse = async () => {
    const next = !collapsed;
    setCollapsed(next);
    if (next) setShowMenu(false);
    const expandedSize = settings.compact ? COMPACT_WINDOW_SIZE : NORMAL_WINDOW_SIZE;
    await window.electronAPI?.setCollapsed(next, expandedSize);
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

  const handleRegister = async () => {
    if (!email.trim() || !password) return;
    setAuthError('');
    setAuthLoading(true);
    try {
      const u = await register(email.trim(), password, name.trim());
      setUser(u);
      setCredits(u.credits_balance);
      setPassword('');
      setPlansReturnView(null); // fresh signup — continue to setup after purchase
      setView('plans');
    } catch (error: any) {
      setAuthError(error.message);
    } finally {
      setAuthLoading(false);
    }
  };

  // Load credit packages whenever the plans screen is shown.
  useEffect(() => {
    if (view !== 'plans') return;
    setPlansError('');
    fetchPackages()
      .then(setPackages)
      .catch((e) => setPlansError(e.message));
  }, [view]);

  const handleChoosePackage = async (packageId: string) => {
    if (orderingId) return;
    setPlansError('');
    setOrderingId(packageId);
    try {
      const order = await createOrder(packageId);
      if (order.paymentUrl) {
        setPendingOrderId(order.orderId);
        setPendingPaymentUrl(order.paymentUrl);
        setView('awaiting-payment');
        // Fire-and-forget: if the system browser fails to open, the
        // awaiting screen shows the link for manual opening/copying.
        window.electronAPI?.openExternal(order.paymentUrl);
      } else {
        // Mock gateway (local dev) — no hosted page, capture directly.
        const res = await payOrderMock(order.orderId);
        setCredits(res.credits);
        setView(plansReturnView ?? 'setup');
        setPlansReturnView(null);
      }
    } catch (error: any) {
      if (error instanceof ApiError && error.status === 401) {
        handleLogout();
        return;
      }
      setPlansError(error.message);
    } finally {
      setOrderingId(null);
    }
  };

  const checkPendingOrder = async () => {
    if (!pendingOrderId) return;
    try {
      const order = await fetchOrder(pendingOrderId);
      if (order.status === 'paid') {
        setPendingOrderId(null);
        setPendingPaymentUrl(null);
        const u = await fetchMe();
        setUser(u);
        setCredits(u.credits_balance);
        setView(plansReturnView ?? 'setup');
        setPlansReturnView(null);
      }
    } catch {
      // Transient network errors are fine — the poll will try again.
    }
  };

  // Poll the order while waiting for the Razorpay webhook to confirm payment.
  useEffect(() => {
    if (view !== 'awaiting-payment' || !pendingOrderId) return;
    const id = setInterval(checkPendingOrder, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, pendingOrderId]);

  const handleLogout = () => {
    clearToken();
    setUser(null);
    setMessages([]);
    setPendingOrderId(null);
    setPendingPaymentUrl(null);
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

  const addImages = (dataUrls: string[]) => {
    setSelectedImages(prev => [...prev, ...dataUrls].slice(0, MAX_IMAGES));
  };

  const handleTakeScreenshot = async () => {
    try {
      const screenshotBase64 = await window.electronAPI?.takeScreenshot();
      if (screenshotBase64) {
        addImages([await compressImage(screenshotBase64)]);
      }
    } catch (error) {
      console.error("Failed to take screenshot:", error);
    }
  };

  const handleSubmit = async (overrideText?: string) => {
    const text = overrideText ?? input;
    if ((!text.trim() && !selectedImages.length) || isLoading) return;

    const userMessage: Message = {
      role: 'user',
      content: text,
      images: selectedImages.length ? selectedImages : undefined
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setSelectedImages([]);
    setIsLoading(true);

    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      // In custom mode the textarea holds the system prompt itself; otherwise
      // it's optional extra context appended to the mode's preset prompt.
      const isCustom = promptMode === 'custom';
      const res = await askCopilot(
        isCustom ? '' : context,
        history,
        userMessage.content,
        userMessage.images ?? [],
        promptMode,
        isCustom ? context : '',
        webSearch
      );
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
        <div className="brand-pill">
          <span className="brand-dot" />
          <span className="brand-name">Interview Copilot</span>
        </div>
        <div className="header-controls">
          {!collapsed && user && (
            <button
              className="credits-pill"
              title="Buy credits"
              onClick={() => {
                if (view === 'plans' || view === 'awaiting-payment') return;
                setPlansReturnView(view);
                setView('plans');
              }}
            >
              <Coins size={12} />
              {credits}
            </button>
          )}
          {!collapsed && captureStatus && (
            <span
              className={`shield-pill ${captureStatus.protected ? 'protected' : 'exposed'}`}
              title={`${captureStatus.protected ? 'Hidden' : 'Exposed'} — ${captureStatus.note}`}
            >
              {captureStatus.protected ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
            </span>
          )}
          {!collapsed && user && (
            <div className="menu-wrapper">
              <button className="icon-btn" onClick={() => setShowMenu((v) => !v)}>
                <MoreVertical size={14} />
              </button>
              {showMenu && (
                <>
                  <div className="menu-backdrop" onClick={() => setShowMenu(false)} />
                  <div className="dropdown-menu">
                    <button onClick={() => { setMessages([]); setSelectedImages([]); setShowMenu(false); }}>
                      <RotateCcw size={14} /> New chat
                    </button>
                    <button onClick={() => { setView('setup'); setShowMenu(false); }}>
                      <Settings size={14} /> Mode &amp; context
                    </button>
                    <button onClick={() => { setShowSettings(true); setShowMenu(false); }}>
                      <SlidersHorizontal size={14} /> Settings
                    </button>
                    <button onClick={() => { setShowMenu(false); window.electronAPI?.toggleStealth(false); }}>
                      <EyeOff size={14} /> Hide app
                      <kbd className="menu-shortcut">{isMac ? '⌘⇧Space' : 'Ctrl+⇧+Space'}</kbd>
                    </button>
                    <button className="danger" onClick={() => { setShowMenu(false); handleLogout(); }}>
                      <LogOut size={14} /> Log out
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          {!collapsed && (
            <button className="icon-btn square-btn" onClick={handleMinimize}>
              <Minus size={14} />
            </button>
          )}
          {/* Kept immediately before Close in both states (same neighbor on
              either side) so the Hide/Ask button never shifts position when
              the surrounding buttons appear/disappear on collapse. */}
          <button
            className={`pill-btn ${collapsed ? 'accent' : ''}`}
            onClick={handleToggleCollapse}
          >
            {collapsed ? <Sparkles size={14} /> : <EyeOff size={14} />}
            <span>{collapsed ? 'Ask' : 'Hide'}</span>
          </button>
          <button className="icon-btn square-btn" onClick={handleClose}>
            <X size={14} />
          </button>
        </div>
      </div>

      {!collapsed && showSettings && (
        <SettingsPanel
          settings={settings}
          onChange={updateSettings}
          onClose={() => setShowSettings(false)}
          screenShareHidingSupported={captureStatus?.supported ?? false}
        />
      )}

      {!collapsed && updateStatus && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            fontSize: 12,
            color: 'var(--text-secondary)',
            borderBottom: '1px solid var(--glass-border)',
          }}
        >
          <Download size={13} style={{ flexShrink: 0 }} />
          {updateStatus.state === 'downloading' ? (
            <span style={{ flex: 1 }}>
              Downloading update{updateStatus.version ? ` v${updateStatus.version}` : ''}
              {updateStatus.percent !== undefined ? ` — ${updateStatus.percent}%` : '…'}
            </span>
          ) : (
            <>
              <span style={{ flex: 1 }}>
                Update {updateStatus.version ? `v${updateStatus.version} ` : ''}ready
              </span>
              <button
                onClick={() => window.electronAPI?.installUpdate()}
                style={{
                  background: 'var(--accent-color)',
                  color: 'white',
                  border: 'none',
                  borderRadius: 4,
                  padding: '3px 10px',
                  fontSize: 11,
                }}
              >
                Restart to update
              </button>
              <button
                onClick={() => setUpdateStatus(null)}
                style={{ background: 'none', border: 'none', color: 'inherit', padding: 0, display: 'flex' }}
              >
                <X size={13} />
              </button>
            </>
          )}
        </div>
      )}

      {!collapsed && view === 'loading' && (
        <div className="view-container" style={{ alignItems: 'center', justifyContent: 'center' }}>
          <div className="login-logo pulse">
            <Sparkles size={22} />
          </div>
        </div>
      )}

      {!collapsed && view === 'login' && (
        <div className="view-container">
          <div className="login-brand">
            <div className="login-logo">
              <Sparkles size={22} />
            </div>
            <span className="login-title">Interview Copilot</span>
            <span className="login-subtitle">Sign in to start your session</span>
          </div>

          <div className="glass-panel">
            <label className="label">Email</label>
            <div className="input-with-icon">
              <Mail size={15} />
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="glass-panel">
            <label className="label">Password</label>
            <div className="input-with-icon">
              <Lock size={15} />
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              />
            </div>
          </div>
          {authError && (
            <div className="auth-error">
              <AlertCircle size={14} style={{ flexShrink: 0 }} />
              {authError}
            </div>
          )}
          <button
            className="primary"
            onClick={handleLogin}
            disabled={!email.trim() || !password || authLoading}
          >
            {authLoading ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="auth-hint">
            Don't have an account?{' '}
            <button className="link-btn" onClick={() => { setAuthError(''); setView('register'); }}>
              Create one
            </button>
          </p>
        </div>
      )}

      {!collapsed && view === 'register' && (
        <div className="view-container">
          <div className="login-brand">
            <div className="login-logo">
              <Sparkles size={22} />
            </div>
            <span className="login-title">Create your account</span>
            <span className="login-subtitle">Then pick a credit pack to get started</span>
          </div>

          <div className="glass-panel">
            <label className="label">Name</label>
            <div className="input-with-icon">
              <UserIcon size={15} />
              <input
                type="text"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>
          <div className="glass-panel">
            <label className="label">Email</label>
            <div className="input-with-icon">
              <Mail size={15} />
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="glass-panel">
            <label className="label">Password</label>
            <div className="input-with-icon">
              <Lock size={15} />
              <input
                type="password"
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
              />
            </div>
          </div>
          {authError && (
            <div className="auth-error">
              <AlertCircle size={14} style={{ flexShrink: 0 }} />
              {authError}
            </div>
          )}
          <button
            className="primary"
            onClick={handleRegister}
            disabled={!email.trim() || password.length < 6 || authLoading}
          >
            {authLoading ? 'Creating account…' : 'Create account'}
          </button>
          <p className="auth-hint">
            Already have an account?{' '}
            <button className="link-btn" onClick={() => { setAuthError(''); setView('login'); }}>
              Sign in
            </button>
          </p>
        </div>
      )}

      {!collapsed && view === 'plans' && (
        <div className="view-container">
          <div className="login-brand">
            <div className="login-logo">
              <Zap size={22} />
            </div>
            <span className="login-title">Choose a credit pack</span>
            <span className="login-subtitle">Credits power every question you ask</span>
          </div>

          {plansError && (
            <div className="auth-error">
              <AlertCircle size={14} style={{ flexShrink: 0 }} />
              {plansError}
            </div>
          )}

          {!packages && !plansError && (
            <div className="empty-state">
              <span className="typing-dots"><span /><span /><span /></span>
            </div>
          )}

          {packages?.map((pkg) => (
            <button
              key={pkg.id}
              className="plan-card"
              onClick={() => handleChoosePackage(pkg.id)}
              disabled={orderingId !== null}
            >
              <div className="plan-card-info">
                <span className="plan-card-name">{pkg.name}</span>
                <span className="plan-card-credits">{pkg.credits} credits</span>
              </div>
              <span className="plan-card-price">
                {orderingId === pkg.id ? 'Opening…' : `₹${pkg.price}`}
              </span>
            </button>
          ))}

          {user && (plansReturnView || credits > 0) && (
            <p className="auth-hint">
              <button
                className="link-btn"
                onClick={() => {
                  setView(plansReturnView ?? 'setup');
                  setPlansReturnView(null);
                }}
              >
                {plansReturnView ? 'Back' : `Skip for now — I have ${credits} credits`}
              </button>
            </p>
          )}
        </div>
      )}

      {!collapsed && view === 'awaiting-payment' && (
        <div className="view-container" style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <div className="login-logo pulse">
            <ExternalLink size={22} />
          </div>
          <span className="login-title">Waiting for payment…</span>
          <span className="login-subtitle">
            Complete the payment in your browser. This screen updates automatically once it goes through.
          </span>
          {pendingPaymentUrl && (
            <>
              <button
                className="primary"
                style={{ maxWidth: 260 }}
                onClick={() => window.electronAPI?.openExternal(pendingPaymentUrl)}
              >
                Open payment page
              </button>
              <span className="payment-url" style={{ userSelect: 'all' }}>{pendingPaymentUrl}</span>
            </>
          )}
          <button className="primary" style={{ maxWidth: 260 }} onClick={checkPendingOrder}>
            I've paid — check now
          </button>
          <p className="auth-hint">
            <button className="link-btn" onClick={() => { setPendingOrderId(null); setPendingPaymentUrl(null); setView('plans'); }}>
              Choose a different plan
            </button>
          </p>
        </div>
      )}

      {!collapsed && view === 'setup' && (
        <div className="view-container">
          <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div className="section-header">
              <div className="section-header-icon">
                <MessageSquare size={13} />
              </div>
              <div className="section-header-text">
                <label className="label" style={{ marginBottom: 0 }}>Assistant Mode</label>
                <div className="section-header-hint">Pick what you need help with</div>
              </div>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 6,
                marginTop: 10,
              }}
            >
              {promptModes.map((m) => (
                <button
                  key={m.value}
                  className={promptMode === m.value ? 'primary' : ''}
                  style={{ fontSize: 12, padding: '8px 6px' }}
                  onClick={() => setPromptMode(m.value)}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <textarea
              placeholder={
                promptMode === 'custom'
                  ? 'Write your own instructions for the AI — this becomes its system prompt...'
                  : 'Optional: paste job description, resume highlights, or extra instructions...'
              }
              value={context}
              onChange={(e) => setContext(e.target.value)}
              style={{ flex: 1, resize: 'none', marginTop: 10 }}
            />
          </div>

          <button className="primary" onClick={() => setView('chat')}>
            Start Copilot
          </button>

          <div className="version-row">
            {appVersion && <span>v{appVersion}</span>}
            <button onClick={handleCheckForUpdates} disabled={checkResult === 'checking'}>
              {checkResult === 'checking' ? 'Checking…' : 'Check for updates'}
            </button>
            {checkResult === 'latest' && <span>You're on the latest version</span>}
            {checkResult === 'failed' && <span>Check failed — try again later</span>}
          </div>
        </div>
      )}

      {!collapsed && view === 'chat' && (
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
                  style={{ background: 'none', border: 'none', color: 'inherit', textDecoration: 'underline', display: 'block', marginTop: 4, fontSize: 11, padding: 0 }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
          {isExposed && (
            <div className="stealth-actions">
              <button onClick={() => window.electronAPI?.toggleStealth(false)}>
                <EyeOff size={14} /> Panic hide
              </button>
              <button onClick={handleMoveDisplay}>
                <MonitorUp size={14} /> Move display
              </button>
            </div>
          )}
          <div className="chat-messages">
            {messages.length === 0 && (
              <div className="empty-state">
                <div className="empty-state-icon">
                  <Sparkles size={20} />
                </div>
                <div className="empty-state-title">Ready to assist</div>
                <div className="empty-state-subtitle">Upload a screenshot or ask a question to get started.</div>
                <div className="empty-state-shortcuts">
                  <div><kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd> Hide overlay</div>
                  <div><kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> Move to next display</div>
                  <div><kbd>Enter</kbd> Send message</div>
                </div>
              </div>
            )}
            {messages.map((msg, idx) => (
              <div key={idx} className={`message-row ${msg.role}`}>
                <div className="message-avatar">
                  {msg.role === 'user' ? <UserIcon size={12} /> : <Sparkles size={12} />}
                </div>
                <div className="message">
                  <div className="markdown-body">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                  {msg.images?.map((img, i) => <img key={i} src={img} alt={`upload ${i + 1}`} />)}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="message-row assistant">
                <div className="message-avatar">
                  <Sparkles size={12} />
                </div>
                <div className="message">
                  <span className="typing-dots">
                    <span /><span /><span />
                  </span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {selectedImages.length > 0 && (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                {selectedImages.map((img, i) => (
                  <div key={i} style={{ position: 'relative', display: 'inline-block', width: 'fit-content' }}>
                    <img src={img} alt={`preview ${i + 1}`} style={{ height: '60px', borderRadius: '4px', border: '1px solid var(--glass-border)' }} />
                    <button
                      onClick={() => setSelectedImages(prev => prev.filter((_, j) => j !== i))}
                      style={{ position: 'absolute', top: -6, right: -6, background: '#ef4444', color: 'white', border: 'none', borderRadius: '50%', width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
                {selectedImages.length >= MAX_IMAGES && (
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Max {MAX_IMAGES} images per request</span>
                )}
              </div>
            )}

            {settings.quickMessages.length > 0 && (
              <div className="quick-suggestions">
                {settings.quickMessages.map((suggestion, i) => (
                  <button
                    key={`${i}-${suggestion}`}
                    className="suggestion-chip"
                    onClick={() => handleSubmit(suggestion)}
                    disabled={isLoading}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}

            <div className="input-area">
              <textarea
                placeholder="Ask a question..."
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
              />

              <button
                className="icon-btn"
                title={webSearch ? 'Web search on — answers can use live internet data' : 'Web search off'}
                style={webSearch ? { background: 'var(--accent-color)' } : undefined}
                onClick={() => setWebSearch((v) => !v)}
              >
                <Globe size={18} color={webSearch ? 'white' : 'var(--text-secondary)'} />
              </button>

              <button className="icon-btn" onClick={handleTakeScreenshot} disabled={selectedImages.length >= MAX_IMAGES}>
                <Camera size={18} />
              </button>

              <button
                className="icon-btn"
                style={{ background: (input.trim() || selectedImages.length) && !isLoading ? 'var(--accent-color)' : 'transparent' }}
                onClick={() => handleSubmit()}
                disabled={(!input.trim() && !selectedImages.length) || isLoading}
              >
                <Send size={18} color={(input.trim() || selectedImages.length) && !isLoading ? 'white' : 'var(--text-secondary)'} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
