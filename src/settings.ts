export type FontSize = 'sm' | 'md' | 'lg';

// Must stay in sync with NORMAL_SIZE / COMPACT_SIZE in electron/main.js — the
// renderer needs these to tell the main process what size to restore to when
// expanding out of the collapsed pill state.
export const NORMAL_WINDOW_SIZE = { width: 400, height: 750 };
export const COMPACT_WINDOW_SIZE = { width: 320, height: 560 };

export type AppSettings = {
  compact: boolean;
  hideFromScreenShare: boolean;
  opacity: number; // 20-90, percentage
  accentColor: string;
  accentHover: string;
  fontSize: FontSize;
  quickMessages: string[];
};

export const ACCENT_SWATCHES = [
  { name: 'Indigo', color: '#6366f1', hover: '#4f46e5' },
  { name: 'Blue', color: '#3b82f6', hover: '#2563eb' },
  { name: 'Emerald', color: '#22c55e', hover: '#16a34a' },
  { name: 'Rose', color: '#ec4899', hover: '#db2777' },
  { name: 'Amber', color: '#f97316', hover: '#ea580c' },
];

export const FONT_SIZE_PX: Record<FontSize, string> = {
  sm: '13px',
  md: '14px',
  lg: '16px',
};

export const DEFAULT_SETTINGS: AppSettings = {
  compact: false,
  hideFromScreenShare: true,
  opacity: 70,
  accentColor: ACCENT_SWATCHES[0].color,
  accentHover: ACCENT_SWATCHES[0].hover,
  fontSize: 'md',
  quickMessages: [
    'What should I say?',
    'Give me a hint',
    'Explain this concept',
    'What\'s the time/space complexity?',
  ],
};

const STORAGE_KEY = 'ih_settings';

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

// Darkens a #rrggbb hex color by the given percentage, for a hover shade.
export function darken(hex: string, amount = 15): string {
  const m = hex.replace('#', '');
  if (m.length !== 6) return hex;
  const num = parseInt(m, 16);
  const factor = 1 - amount / 100;
  const r = Math.max(0, Math.round(((num >> 16) & 0xff) * factor));
  const g = Math.max(0, Math.round(((num >> 8) & 0xff) * factor));
  const b = Math.max(0, Math.round((num & 0xff) * factor));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

export function applySettings(settings: AppSettings) {
  const root = document.documentElement.style;
  const alpha = settings.opacity / 100;
  root.setProperty('--bg-color', `rgba(20, 20, 20, ${alpha.toFixed(2)})`);
  root.setProperty('--glass-bg', `rgba(30, 30, 30, ${Math.min(0.95, alpha + 0.2).toFixed(2)})`);
  root.setProperty('--accent-color', settings.accentColor);
  root.setProperty('--accent-hover', settings.accentHover);
  root.setProperty('--content-font-size', FONT_SIZE_PX[settings.fontSize]);
}
