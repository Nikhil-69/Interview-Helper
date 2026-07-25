import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { ACCENT_SWATCHES, darken, type AppSettings, type FontSize } from '../settings';

type Props = {
  settings: AppSettings;
  onChange: (partial: Partial<AppSettings>) => void;
  onClose: () => void;
};

const FONT_SIZE_OPTIONS: { value: FontSize; label: string }[] = [
  { value: 'sm', label: 'Small' },
  { value: 'md', label: 'Medium' },
  { value: 'lg', label: 'Large' },
];

function SettingsPanel({ settings, onChange, onClose }: Props) {
  const [newQuickMessage, setNewQuickMessage] = useState('');

  const updateQuickMessage = (index: number, text: string) => {
    const next = [...settings.quickMessages];
    next[index] = text;
    onChange({ quickMessages: next });
  };

  const removeQuickMessage = (index: number) => {
    onChange({ quickMessages: settings.quickMessages.filter((_, i) => i !== index) });
  };

  const addQuickMessage = () => {
    const text = newQuickMessage.trim();
    if (!text) return;
    onChange({ quickMessages: [...settings.quickMessages, text] });
    setNewQuickMessage('');
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel glass-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-panel-header">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="settings-row">
          <div>
            <label className="label">Reduce window size</label>
            <p className="settings-hint">Shrinks the overlay to a smaller footprint.</p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.compact}
              onChange={(e) => onChange({ compact: e.target.checked })}
            />
            <span className="switch-track" />
          </label>
        </div>

        <div className="settings-row column">
          <label className="label">Background opacity</label>
          <input
            type="range"
            min={20}
            max={90}
            value={settings.opacity}
            onChange={(e) => onChange({ opacity: Number(e.target.value) })}
          />
        </div>

        <div className="settings-row column">
          <label className="label">Accent color</label>
          <div className="swatch-row">
            {ACCENT_SWATCHES.map((s) => (
              <button
                key={s.color}
                className={`swatch ${settings.accentColor === s.color ? 'active' : ''}`}
                style={{ background: s.color }}
                onClick={() => onChange({ accentColor: s.color, accentHover: s.hover })}
              />
            ))}
            <input
              type="color"
              className="swatch custom-swatch"
              value={settings.accentColor}
              onChange={(e) => onChange({ accentColor: e.target.value, accentHover: darken(e.target.value) })}
            />
          </div>
        </div>

        <div className="settings-row column">
          <label className="label">Text size</label>
          <div className="segmented">
            {FONT_SIZE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={settings.fontSize === opt.value ? 'active' : ''}
                onClick={() => onChange({ fontSize: opt.value })}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-row column">
          <label className="label">Quick messages</label>
          <p className="settings-hint">Shown as tappable suggestions above the chat input.</p>
          <div className="quick-msg-list">
            {settings.quickMessages.map((msg, i) => (
              <div className="quick-msg-row" key={i}>
                <input
                  type="text"
                  value={msg}
                  onChange={(e) => updateQuickMessage(i, e.target.value)}
                />
                <button className="icon-btn" onClick={() => removeQuickMessage(i)}>
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
          <div className="quick-msg-row">
            <input
              type="text"
              placeholder="Add a quick message…"
              value={newQuickMessage}
              onChange={(e) => setNewQuickMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addQuickMessage()}
            />
            <button className="icon-btn" onClick={addQuickMessage} disabled={!newQuickMessage.trim()}>
              <Plus size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsPanel;
