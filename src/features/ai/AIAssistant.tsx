import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, CheckCircle2, KeyRound, Send, Settings2, Trash2, X } from 'lucide-react';

import { NeonButton } from '../../components/neon/NeonButton';
import { useAppStore } from '../../store/appStore';
import type { AIChatMessage, AISettings } from '../../../electron/creative/ai-service';

interface DisplayMessage extends AIChatMessage {
  id: string;
  error?: boolean;
}

export const AIAssistant: React.FC = () => {
  const toggleAIAssistant = useAppStore((state) => state.toggleAIAssistant);
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gemini-3.6-flash');
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const loadSettings = useCallback(async (): Promise<void> => {
    try {
      const next = await window.knouxCreativeAPI.ai.settings();
      setSettings(next);
      setModel(next.model);
      setShowSettings(next.provider === 'disabled');
    } catch (reason) {
      setStatusMessage(reason instanceof Error ? reason.message : 'AI settings could not be loaded.');
    }
  }, []);

  useEffect(() => { void loadSettings(); }, [loadSettings]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  const history = useMemo<AIChatMessage[]>(() => messages
    .filter((message) => !message.error)
    .map(({ role, content }) => ({ role, content })), [messages]);

  const configure = useCallback(async (): Promise<void> => {
    setBusy(true);
    setStatusMessage(null);
    try {
      const next = await window.knouxCreativeAPI.ai.configure({
        provider: 'gemini',
        model,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setSettings(next);
      setApiKey('');
      setShowSettings(false);
      setStatusMessage('Gemini was enabled. Only text you explicitly send from this panel is transmitted.');
    } catch (reason) {
      setStatusMessage(reason instanceof Error ? reason.message : 'AI configuration failed.');
    } finally {
      setBusy(false);
    }
  }, [apiKey, model]);

  const disable = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      const next = await window.knouxCreativeAPI.ai.clear();
      setSettings(next);
      setMessages([]);
      setShowSettings(true);
      setStatusMessage('AI credential was removed from secure storage.');
    } finally {
      setBusy(false);
    }
  }, []);

  const testConnection = useCallback(async (): Promise<void> => {
    setBusy(true);
    setStatusMessage('Testing Gemini connection…');
    try {
      const result = await window.knouxCreativeAPI.ai.test();
      setStatusMessage(result.ok ? `Connected in ${result.latencyMs} ms.` : result.message);
    } finally {
      setBusy(false);
    }
  }, []);

  const sendMessage = useCallback(async (): Promise<void> => {
    const message = input.trim();
    if (!message || busy || settings?.provider !== 'gemini') return;
    const userMessage: DisplayMessage = { id: crypto.randomUUID(), role: 'user', content: message };
    setMessages((current) => [...current, userMessage]);
    setInput('');
    setBusy(true);
    setStatusMessage(null);
    try {
      const reply = await window.knouxCreativeAPI.ai.chat(message, history);
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'model', content: reply }]);
    } catch (reason) {
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: 'model',
        content: reason instanceof Error ? reason.message : 'AI request failed.',
        error: true,
      }]);
    } finally {
      setBusy(false);
    }
  }, [busy, history, input, settings?.provider]);

  const cancel = useCallback(async (): Promise<void> => {
    await window.knouxCreativeAPI.ai.cancel();
    setBusy(false);
    setStatusMessage('AI request canceled.');
  }, []);

  return (
    <aside className="secure-ai-panel" aria-label="Optional KNOUX AI assistant">
      <header>
        <div><Bot size={21} /><strong>KNOUX AI</strong><span>{settings?.provider === 'gemini' ? 'Gemini enabled' : 'Disabled'}</span></div>
        <div>
          <button type="button" onClick={() => setShowSettings((value) => !value)} aria-label="AI settings"><Settings2 size={18} /></button>
          <button type="button" onClick={toggleAIAssistant} aria-label="Close AI assistant"><X size={18} /></button>
        </div>
      </header>

      {showSettings ? (
        <div className="secure-ai-settings">
          <div className="secure-ai-notice">
            <KeyRound size={20} />
            <div><strong>Explicit and encrypted</strong><span>The API key is encrypted with Electron safeStorage. Raw video and audio are never sent by this panel.</span></div>
          </div>
          <label><span>Gemini model</span><input value={model} onChange={(event) => setModel(event.target.value)} placeholder="gemini-3.6-flash" /></label>
          <label><span>API key {settings?.hasCredential ? '(leave blank to keep current key)' : ''}</span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" /></label>
          {!settings?.secureStorageAvailable && <div className="creative-error">Secure credential storage is unavailable. AI cannot be enabled safely.</div>}
          <div className="creative-actions">
            <NeonButton variant="primary" onClick={() => void configure()} disabled={busy || !settings?.secureStorageAvailable || (!apiKey.trim() && !settings?.hasCredential)}>Enable Gemini</NeonButton>
            {settings?.provider === 'gemini' && <NeonButton variant="secondary" onClick={() => void testConnection()} disabled={busy}>Test</NeonButton>}
            {settings?.hasCredential && <NeonButton variant="ghost" leftIcon={<Trash2 size={15} />} onClick={() => void disable()} disabled={busy}>Remove key</NeonButton>}
          </div>
        </div>
      ) : (
        <>
          <div className="secure-ai-messages">
            {messages.length === 0 && (
              <div className="secure-ai-empty"><CheckCircle2 size={28} /><strong>Text-only assistance</strong><span>Ask for titles, descriptions, chapter ideas, subtitle cleanup, or an editing plan. No media is uploaded.</span></div>
            )}
            {messages.map((message) => (
              <div key={message.id} className={`secure-ai-message ${message.role} ${message.error ? 'error' : ''}`}>
                <strong>{message.role === 'user' ? 'You' : 'KNOUX AI'}</strong>
                <p>{message.content}</p>
              </div>
            ))}
            {busy && <div className="secure-ai-thinking">Gemini is generating a response…</div>}
            <div ref={endRef} />
          </div>
          <div className="secure-ai-compose">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder="Send text to Gemini…"
              maxLength={12000}
              disabled={busy}
            />
            {busy ? (
              <button type="button" onClick={() => void cancel()} aria-label="Cancel AI request"><X size={18} /></button>
            ) : (
              <button type="button" onClick={() => void sendMessage()} disabled={!input.trim()} aria-label="Send message"><Send size={18} /></button>
            )}
          </div>
        </>
      )}

      {statusMessage && <footer>{statusMessage}</footer>}
    </aside>
  );
};
