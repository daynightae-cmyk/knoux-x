import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Download,
  Film,
  KeyRound,
  Lock,
  LockOpen,
  Play,
  Plus,
  Settings,
  ShieldCheck,
  Trash2,
} from 'lucide-react';

import { BrandMark } from '../../components/brand/BrandMark';
import { androidDocumentTitle } from '../../platform/androidSafBridge';
import {
  androidVault,
  forgetVaultSession,
  setVaultSessionToken,
  vaultPlaybackUrl,
  vaultSessionToken,
  watchVaultAutoLock,
  type VaultItem,
  type VaultStatus,
} from '../../platform/androidVault';
import { useAppStore } from '../../store/appStore';
import { usePlayerStore } from '../../store/playerStore';

type VaultStage = 'checking' | 'create' | 'unlock' | 'open';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function formatDate(epochSeconds: number, locale: string): string {
  if (!epochSeconds) return '—';
  try {
    return new Date(epochSeconds * 1000).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '—';
  }
}

export const MobileVaultView: React.FC = () => {
  const setView = useAppStore((state) => state.setView);
  const addNotification = useAppStore((state) => state.addNotification);
  const locale = useAppStore((state) => state.locale);
  const setCurrentMedia = usePlayerStore((state) => state.setCurrentMedia);
  const setMediaTitle = usePlayerStore((state) => state.setMediaTitle);
  const ar = locale === 'ar';
  const native = androidVault();

  const [stage, setStage] = useState<VaultStage>('checking');
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [items, setItems] = useState<VaultItem[]>([]);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingOriginal, setPendingOriginal] = useState<{ uri: string; name: string } | null>(null);
  const [confirmDeleteOriginal, setConfirmDeleteOriginal] = useState(false);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});

  const refreshStatus = useCallback(async (): Promise<void> => {
    if (!native) return;
    try {
      const next = await native.vaultStatus();
      setStatus(next);
      if (!next.created) { setItems([]); setStage('create'); }
      else if (next.locked) { setItems([]); setStage('unlock'); }
      else setStage('open');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStage('unlock');
    }
  }, [native]);

  useEffect(() => {
    void refreshStatus();
    return watchVaultAutoLock();
  }, [refreshStatus]);

  /* The vault locks itself while the app is away, so the screen re-reads the
   * real state when the user comes back. */
  useEffect(() => {
    const onVisibility = (): void => {
      if (document.hidden) return;
      void refreshStatus();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [refreshStatus]);

  useEffect(() => {
    if (stage !== 'open') return;
    const token = vaultSessionToken();
    if (!token || !native) return;
    void native.vaultList({ token }).then((page) => setItems(page.items ?? [])).catch(() => undefined);
  }, [native, stage]);

  const createVault = useCallback(async (): Promise<void> => {
    if (!native) return;
    if (pin.length < 4) { setError(ar ? 'يجب أن يتكون الرمز من أربعة أحرف على الأقل.' : 'The vault PIN needs at least four characters.'); return; }
    if (pin !== confirmPin) { setError(ar ? 'الرمزان غير متطابقين.' : 'The two PINs do not match.'); return; }
    setBusy(true);
    setError(null);
    try {
      const result = await native.vaultCreate({ pin });
      setVaultSessionToken(result.token);
      setPin('');
      setConfirmPin('');
      const page = await native.vaultList({ token: result.token });
      setItems(page.items ?? []);
      setStage('open');
      setStatus(await native.vaultStatus());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }, [ar, confirmPin, native, pin]);

  const unlockVault = useCallback(async (): Promise<void> => {
    if (!native) return;
    if (!pin) { setError(ar ? 'أدخل رمز الخزنة.' : 'Enter the vault PIN.'); return; }
    setBusy(true);
    setError(null);
    try {
      const result = await native.vaultUnlock({ pin });
      setVaultSessionToken(result.token);
      setPin('');
      setItems(result.items ?? []);
      setStage('open');
      setStatus(await native.vaultStatus());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      void refreshStatus();
    } finally {
      setBusy(false);
    }
  }, [ar, native, pin, refreshStatus]);

  const lockVault = useCallback(async (): Promise<void> => {
    if (!native) return;
    setBusy(true);
    try {
      await native.vaultLock();
    } catch { /* the session is dropped either way */ }
    forgetVaultSession();
    setItems([]);
    setStage('unlock');
    setStatus(await native.vaultStatus().catch(() => null));
    setBusy(false);
  }, [native]);

  const changePin = useCallback(async (): Promise<void> => {
    const token = vaultSessionToken();
    if (!native || !token) return;
    if (newPin.length < 4) { setError(ar ? 'الرمز الجديد قصير جدًا.' : 'The new PIN is too short.'); return; }
    setBusy(true);
    setError(null);
    try {
      await native.vaultChangePin({ token, newPin });
      setNewPin('');
      addNotification({ type: 'success', title: ar ? 'تم تغيير الرمز' : 'PIN changed', message: ar ? 'استخدم الرمز الجديد لفتح الخزنة.' : 'Use the new PIN to open the vault.', duration: 3000 });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }, [addNotification, ar, native, newPin]);

  const importMedia = useCallback(async (): Promise<void> => {
    const token = vaultSessionToken();
    if (!native || !token) return;
    setBusy(true);
    setError(null);
    try {
      const picked = await window.knouxAPI.file.openFile({
        title: ar ? 'اختر وسائط للتشفير' : 'Choose media to encrypt',
        filters: [{ name: 'Videos', extensions: ['mp4', 'webm', 'm4v', 'mov', 'mkv'] }, { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac'] }],
        properties: ['openFile'],
      });
      if (!picked) { setBusy(false); return; }
      const name = await androidDocumentTitle(picked).catch(() => '') || picked.split('/').pop() || 'Encrypted media';
      const extension = name.split('.').pop()?.toLowerCase() ?? '';
      const mime = extension === 'mp3' || extension === 'wav' || extension === 'ogg' || extension === 'm4a' || extension === 'aac'
        ? `audio/${extension === 'm4a' ? 'mp4' : extension}`
        : `video/${extension === 'mkv' ? 'x-matroska' : extension || 'mp4'}`;
      const result = await native.vaultImport({ token, uri: picked, name, mime });
      setItems(result.items ?? []);
      setPendingOriginal({ uri: picked, name });
      addNotification({
        type: 'success',
        title: ar ? 'تم التشفير' : 'Encrypted into the vault',
        message: ar ? 'النسخة الأصلية لم تُمس.' : 'The original file was left untouched.',
        duration: 3500,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }, [addNotification, ar, native]);

  const playItem = useCallback(async (item: VaultItem): Promise<void> => {
    const token = vaultSessionToken();
    if (!native || !token) return;
    setBusy(true);
    setError(null);
    try {
      const opened = await native.vaultOpen({ token, id: item.id });
      const url = vaultPlaybackUrl(opened.uri);
      setMediaTitle(opened.uri, opened.name || item.name);
      setCurrentMedia(opened.uri);
      setView('player');
      addNotification({ type: 'info', title: ar ? 'يتم فك التشفير للتشغيل' : 'Decrypted for playback', message: opened.name || item.name, duration: 2500 });
      void url;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }, [addNotification, ar, native, setCurrentMedia, setMediaTitle, setView]);

  const exportItem = useCallback(async (item: VaultItem): Promise<void> => {
    const token = vaultSessionToken();
    if (!native || !token) return;
    setBusy(true);
    setError(null);
    try {
      const target = await window.knouxAPI.file.saveFile({
        title: ar ? 'أين تريد فك التشفير؟' : 'Where should the decrypted copy go?',
        defaultPath: item.name,
        filters: [{ name: 'Media', extensions: ['mp4', 'webm', 'm4v', 'mov', 'mkv', 'mp3', 'wav', 'ogg', 'm4a'] }],
      });
      if (!target) { setBusy(false); return; }
      const result = await native.vaultExport({ token, id: item.id, targetUri: target });
      addNotification({
        type: 'success',
        title: ar ? 'تم التصدير' : 'Exported',
        message: `${item.name} · ${formatBytes(result.bytes)}`,
        duration: 3500,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }, [addNotification, ar, native]);

  const deleteItem = useCallback(async (item: VaultItem): Promise<void> => {
    const token = vaultSessionToken();
    if (!native || !token) return;
    setBusy(true);
    setError(null);
    try {
      const result = await native.vaultDelete({ token, id: item.id });
      setItems(result.items ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }, [native]);

  const deleteOriginal = useCallback(async (): Promise<void> => {
    if (!pendingOriginal) return;
    setBusy(true);
    try {
      const deleted = await window.knouxAPI.file.deleteFile(pendingOriginal.uri);
      if (!deleted) {
        addNotification({
          type: 'error',
          title: ar ? 'لم يُحذف الأصل' : 'The original was not deleted',
          message: ar ? 'لا يسمح الجهاز بحذف هذا الملف. النسخة المشفرة محفوظة.' : 'The device refused to delete that file. The encrypted copy is safe.',
          duration: 4000,
        });
      } else {
        addNotification({ type: 'success', title: ar ? 'حُذف الأصل' : 'Original deleted', message: pendingOriginal.name, duration: 3000 });
      }
      setPendingOriginal(null);
      setConfirmDeleteOriginal(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }, [addNotification, ar, pendingOriginal]);

  useEffect(() => {
    if (stage !== 'open') return;
    const token = vaultSessionToken();
    if (!token || !native) return;
    for (const item of items) {
      if (thumbnails[item.id]) continue;
      void native.vaultThumbnail({ token, id: item.id }).then((result) => {
        if (!result.uri) return;
        setThumbnails((current) => ({ ...current, [item.id]: result.uri as string }));
      }).catch(() => undefined);
    }
  }, [items, native, stage, thumbnails]);

  const statusLine = useMemo(() => {
    if (!status) return '';
    if (status.lockedOutForMs > 0) return ar ? 'تم إيقاف القفل مؤقتًا. حاول لاحقًا.' : 'The vault is locked for a moment after too many attempts.';
    if (status.created && !status.keyAvailable) return ar ? 'مفتاح الجهاز لم يعد متاحًا. لا يمكن استعادة المحتوى المشفر.' : 'The device key is no longer available. The encrypted media cannot be recovered.';
    return '';
  }, [ar, status]);

  if (!native) {
    return (
      <section className="knoux-mobile-vault" data-component="MobileVaultView">
        <p className="kvv-empty">{ar ? 'الخزنة متاحة على أندرويد فقط.' : 'The private vault is available on Android.'}</p>
      </section>
    );
  }

  return (
    <section className="knoux-mobile-vault" data-component="MobileVaultView" dir={ar ? 'rtl' : 'ltr'}>
      <header className="kml-header">
        <button type="button" className="kml-round" aria-label={ar ? 'العودة للرئيسية' : 'Back to home'} onClick={() => setView('home')}><ArrowLeft size={21} /></button>
        <div className="kml-brand"><BrandMark size={50} /><div><strong>KNOUX <span>X</span></strong><small>{ar ? 'خزنة مشفّرة' : 'ENCRYPTED VAULT'}</small></div></div>
        <button type="button" className="kml-round" aria-label={ar ? 'الإعدادات' : 'Settings'} onClick={() => setView('settings')}><Settings size={20} /></button>
      </header>

      <div className="kvv-stage" data-vault-stage={stage}>
        {stage === 'create' && (
          <div className="kvv-card">
            <h1><ShieldCheck size={22} />{ar ? 'أنشئ خزنتك' : 'Create your vault'}</h1>
            <p>{ar ? 'يُشفَّر المحتوى بمفتاح لا يغادر الجهاز. لا يوجد استرجاع.' : 'Your media is encrypted with a key that never leaves this device. There is no recovery path.'}</p>
            <label><span>{ar ? 'الرمز' : 'PIN'}</span><input type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(event) => setPin(event.currentTarget.value)} aria-label={ar ? 'رمز الخزنة' : 'Vault PIN'} /></label>
            <label><span>{ar ? 'تأكيد الرمز' : 'Confirm PIN'}</span><input type="password" inputMode="numeric" autoComplete="new-password" value={confirmPin} onChange={(event) => setConfirmPin(event.currentTarget.value)} aria-label={ar ? 'تأكيد رمز الخزنة' : 'Confirm vault PIN'} /></label>
            <button type="button" className="kvv-primary" disabled={busy} onClick={() => void createVault()}>{ar ? 'إنشاء الخزنة' : 'Create the vault'}</button>
          </div>
        )}

        {stage === 'unlock' && (
          <div className="kvv-card">
            <h1><Lock size={22} />{ar ? 'الخزنة مقفلة' : 'The vault is locked'}</h1>
            <p>{ar ? 'أدخل الرمز لفتح المحتوى المشفر.' : 'Enter the PIN to open the encrypted media.'}</p>
            <label><span>{ar ? 'الرمز' : 'PIN'}</span><input type="password" inputMode="numeric" autoComplete="current-password" value={pin} onChange={(event) => setPin(event.currentTarget.value)} aria-label={ar ? 'رمز الخزنة' : 'Vault PIN'} /></label>
            <button type="button" className="kvv-primary" disabled={busy} onClick={() => void unlockVault()}>{ar ? 'فتح' : 'Unlock'}</button>
          </div>
        )}

        {stage === 'open' && (
          <>
            <div className="kvv-toolbar">
              <span><ShieldCheck size={16} />{ar ? `${items.length} عنصر مشفّر` : `${items.length} encrypted item${items.length === 1 ? '' : 's'}`}</span>
              <button type="button" onClick={() => void importMedia()} disabled={busy}><Plus size={17} />{ar ? 'تشفير وسائط' : 'Encrypt media'}</button>
              <button type="button" onClick={() => void lockVault()} disabled={busy}><LockOpen size={17} />{ar ? 'قفل' : 'Lock'}</button>
            </div>

            {pendingOriginal && (
              <div className="kvv-original" role="status">
                <div>
                  <strong>{ar ? 'النسخة المشفرة جاهزة' : 'The encrypted copy is verified'}</strong>
                  <span>{ar ? 'الملف الأصلي ما زال على الجهاز.' : 'The original file is still on the device.'}</span>
                </div>
                {confirmDeleteOriginal ? (
                  <div className="kvv-confirm">
                    <span>{ar ? 'حذف الأصل نهائيًا؟' : 'Delete the original for good?'}</span>
                    <button type="button" onClick={() => void deleteOriginal()}>{ar ? 'نعم، احذف الأصل' : 'Yes, delete the original'}</button>
                    <button type="button" onClick={() => { setConfirmDeleteOriginal(false); setPendingOriginal(null); }}>{ar ? 'أبقِ الأصل' : 'Keep the original'}</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setConfirmDeleteOriginal(true)}>{ar ? 'حذف الأصل' : 'Delete the original'}</button>
                )}
              </div>
            )}

            {items.length === 0 ? (
              <p className="kvv-empty">{ar ? 'الخزنة فارغة. شفّر وسائطك الخاصة.' : 'The vault is empty. Encrypt the media you want to keep private.'}</p>
            ) : (
              <div className="kvv-grid">
                {items.map((item) => (
                  <article className="kvv-item" key={item.id}>
                    <span className="kvv-art">
                      {thumbnails[item.id] ? <img src={vaultPlaybackUrl(thumbnails[item.id])} alt="" loading="lazy" /> : <Film size={22} />}
                    </span>
                    <strong title={item.name}>{item.name}</strong>
                    <small>{formatBytes(item.size)} · {formatDate(item.createdAt, locale)}</small>
                    <div className="kvv-actions">
                      <button type="button" onClick={() => void playItem(item)}><Play size={15} />{ar ? 'تشغيل' : 'Play'}</button>
                      <button type="button" onClick={() => void exportItem(item)}><Download size={15} />{ar ? 'تصدير' : 'Export'}</button>
                      <button type="button" onClick={() => void deleteItem(item)}><Trash2 size={15} />{ar ? 'حذف' : 'Delete'}</button>
                    </div>
                  </article>
                ))}
              </div>
            )}

            <div className="kvv-pin">
              <h3><KeyRound size={16} />{ar ? 'تغيير الرمز' : 'Change the PIN'}</h3>
              <label><span>{ar ? 'الرمز الجديد' : 'New PIN'}</span><input type="password" inputMode="numeric" autoComplete="new-password" value={newPin} onChange={(event) => setNewPin(event.currentTarget.value)} aria-label={ar ? 'الرمز الجديد' : 'New vault PIN'} /></label>
              <button type="button" disabled={busy} onClick={() => void changePin()}>{ar ? 'تحديث' : 'Update'}</button>
            </div>
          </>
        )}

        {statusLine && <p className="kvv-warning" role="alert">{statusLine}</p>}
        {error && <p className="kvv-error" role="alert">{error}</p>}
        {busy && <p className="kvv-busy" role="status">{ar ? 'جارٍ العمل…' : 'Working…'}</p>}
      </div>

      <footer className="kml-footer">ENCRYPTED ON THIS DEVICE · KNOUX X</footer>
    </section>
  );
};
