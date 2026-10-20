import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, FolderPlus, Gauge, Globe2, Moon, RotateCcw, ShieldCheck, Sparkles } from 'lucide-react';

import { BrandMark } from '../../components/brand/BrandMark';
import type { StructuredValue } from '../../../electron/ipc/channel-types';
import { ANDROID_DEFAULT_THEME, useAppStore } from '../../store/appStore';
import { MobileOnboarding } from '../../components/mobile/MobileOnboarding';

import { MobileDeveloperView } from './MobileDeveloperView';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

function announceMobileSetting(key: string, value: unknown): void {
  window.dispatchEvent(new CustomEvent('knoux:mobile-setting-changed', { detail: { key, value } }));
}

export const MobileSettingsView: React.FC = () => {
  const setView = useAppStore((state) => state.setView);
  const locale = useAppStore((state) => state.locale);
  const copy = (en: string, ar: string): string => locale === 'ar' ? ar : en;
  const theme = useAppStore((state) => state.theme);
  const motionEnabled = useAppStore((state) => state.motionEnabled);
  const setLocale = useAppStore((state) => state.setLocale);
  const setTheme = useAppStore((state) => state.setTheme);
  const setMotionEnabled = useAppStore((state) => state.setMotionEnabled);
  const [defaultSpeed, setDefaultSpeed] = useState(1);
  const [keepAwake, setKeepAwake] = useState(true);
  const [libraryPath, setLibraryPath] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [about, setAbout] = useState(false);
  const [welcome, setWelcome] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([
      window.knouxAPI.settings.get('mobile.defaultPlaybackSpeed', 1),
      window.knouxAPI.settings.get('mobile.keepScreenAwake', true),
      window.knouxAPI.settings.get('mobile.libraryPath', null),
    ]).then(([speed, awake, path]) => {
      if (!active) return;
      setDefaultSpeed(Number(speed) || 1);
      setKeepAwake(Boolean(awake));
      setLibraryPath(typeof path === 'string' ? path : null);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Settings could not be loaded.'));
    return () => { active = false; };
  }, []);

  const persist = useCallback(async (key: string, value: StructuredValue): Promise<void> => {
    setError(null);
    setNotice(null);
    try {
      await window.knouxAPI.settings.set(key, value);
      announceMobileSetting(key, value);
      setNotice('Saved on this device.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Setting could not be saved.');
    }
  }, []);

  const changeLocale = useCallback((value: 'en' | 'ar'): void => {
    setLocale(value);
    void persist('language', value);
  }, [persist, setLocale]);

  const changeTheme = useCallback((value: typeof ANDROID_DEFAULT_THEME | 'neon-purple' | 'system-light'): void => {
    setTheme(value);
    void persist('theme', value);
  }, [persist, setTheme]);

  const chooseLibrary = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const directory = await window.knouxAPI.file.openDirectory({ title: 'Choose KNOUX media folder' });
      if (!directory) return;
      setLibraryPath(directory);
      await persist('mobile.libraryPath', directory);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Media folder permission could not be persisted.');
    }
  }, [persist]);

  const resetMobile = useCallback(async (): Promise<void> => {
    try {
      await Promise.all([
        window.knouxAPI.settings.reset('mobile.defaultPlaybackSpeed'),
        window.knouxAPI.settings.reset('mobile.keepScreenAwake'),
        window.knouxAPI.settings.reset('mobile.libraryPath'),
        window.knouxAPI.settings.reset('theme'),
      ]);
      setDefaultSpeed(1);
      setKeepAwake(true);
      setLibraryPath(null);
      setTheme(ANDROID_DEFAULT_THEME);
      announceMobileSetting('mobile.defaultPlaybackSpeed', 1);
      announceMobileSetting('mobile.keepScreenAwake', true);
      announceMobileSetting('mobile.libraryPath', null);
      announceMobileSetting('theme', ANDROID_DEFAULT_THEME);
      setNotice('Mobile settings reset. KNOUX Cinema Dark is restored.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Mobile settings could not be reset.');
    }
  }, [setTheme]);

  if (about) return <MobileDeveloperView onBack={() => setAbout(false)} />;
  return (
    <section className="knoux-mobile-settings" data-component="MobileSettingsView" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <header className="kms-topbar"><button type="button" aria-label="Back" onClick={() => setView('home')}><ArrowLeft size={21} /></button><div><BrandMark size={38} /><span><strong>KNOUX <em>X</em></strong><small>{copy('SETTINGS', 'الإعدادات')}</small></span></div><ShieldCheck size={20} /></header>
      <div className="kms-hero"><span>{copy('LOCAL PREFERENCES', 'على ذوقك')}</span><h1>{copy('Make KNOUX X', 'اجعل KNOUX X')} <em>{copy('yours.', 'على ذوقك.')}</em></h1><p>{copy('A personal space, shaped around you.', 'مساحتك الخاصة، كما تحبّها.')}</p></div>
      {error && <div className="kms-error" role="alert">{error}</div>}
      {notice && <div className="kms-notice" role="status">{notice}</div>}

      <section className="kms-card"><div className="kms-card-title"><Globe2 size={18} /><span><strong>{copy('Language', 'اللغة')}</strong><small>{copy('Interface direction updates immediately.', 'اختر لغتك المفضلة.')}</small></span></div><div className="kms-segment"><button type="button" className={locale === 'en' ? 'active' : ''} onClick={() => changeLocale('en')}>English</button><button type="button" className={locale === 'ar' ? 'active' : ''} onClick={() => changeLocale('ar')}>العربية</button></div></section>

      <section className="kms-card"><div className="kms-card-title"><Moon size={18} /><span><strong>{copy('Appearance', 'المظهر')}</strong><small>{copy('Cinema Dark by default. Daylight remains a deliberate choice.', 'الوضع السينمائي الداكن هو الافتراضي، والنهاري اختيار صريح.')}</small></span></div><div className="kms-segment"><button type="button" className={theme === 'deep-black' ? 'active' : ''} onClick={() => changeTheme('deep-black')}>{copy('Cinema Dark', 'سينمائي داكن')}</button><button type="button" className={theme === 'neon-purple' ? 'active' : ''} onClick={() => changeTheme('neon-purple')}>{copy('Violet', 'بنفسجي')}</button><button type="button" className={theme === 'system-light' ? 'active' : ''} onClick={() => changeTheme('system-light')}>{copy('Daylight', 'نهاري')}</button></div><label className="kms-switch"><span><Sparkles size={17} /> {copy('Motion & transitions', 'الحركة والانتقالات')}</span><input type="checkbox" checked={motionEnabled} onChange={(event) => { setMotionEnabled(event.currentTarget.checked); void persist('motionEnabled', event.currentTarget.checked); }} /></label></section>

      <section className="kms-card"><div className="kms-card-title"><Gauge size={18} /><span><strong>{copy('Playback defaults', 'إعدادات التشغيل')}</strong><small>{copy('Applied once when new media opens; manual speed changes remain yours.', 'سرعة البدء للفيديوهات الجديدة.')}</small></span></div><div className="kms-speed-grid">{SPEEDS.map((speed) => <button type="button" key={speed} className={Math.abs(speed - defaultSpeed) < 0.001 ? 'active' : ''} onClick={() => { setDefaultSpeed(speed); void persist('mobile.defaultPlaybackSpeed', speed); }}>{speed}×</button>)}</div><label className="kms-switch"><span>{copy('Keep screen awake while playing', 'إبقاء الشاشة مضاءة أثناء التشغيل')}</span><input type="checkbox" checked={keepAwake} onChange={(event) => { setKeepAwake(event.currentTarget.checked); void persist('mobile.keepScreenAwake', event.currentTarget.checked); }} /></label></section>

      <section className="kms-card"><div className="kms-card-title"><FolderPlus size={18} /><span><strong>{copy('Media folder', 'مجلد الوسائط')}</strong><small>{libraryPath ? copy('Your chosen folder is connected.', 'مجلدك المختار متصل.') : copy('Choose the folder for your media.', 'اختر مجلد وسائطك.')}</small></span></div><button type="button" className="kms-wide-button" onClick={() => void chooseLibrary()}><FolderPlus size={17} /> {libraryPath ? copy('Change folder', 'تغيير المجلد') : copy('Choose folder', 'اختيار مجلد')}</button>{libraryPath && <code>{libraryPath}</code>}</section>

      <section className="kms-card"><div className="kms-card-title"><ShieldCheck size={18} /><span><strong>{copy('Privacy', 'الخصوصية')}</strong><small>{copy('Playback, editing and local rendering do not upload your media by themselves.', 'تظل وسائطك على جهازك أثناء التشغيل والتعديل المحلي.')}</small></span></div><p className="kms-copy">{copy('Any future AI action that sends selected data off-device must request explicit consent at that action.', 'اطّلع على تفاصيل الخدمات الخارجية واختر ما تريد مشاركته عند استخدامها.')}</p></section>

      <button type="button" className="kms-wide-button" onClick={() => setAbout(true)}>Eng. Sadek Elgazar · {locale === 'ar' ? 'عن المطوّر' : 'About the developer'}</button>
      <button type="button" className="kms-wide-button" onClick={() => setWelcome(true)}>{locale === 'ar' ? 'جولة في التطبيق' : 'Replay welcome tour'}</button>
      {welcome && <MobileOnboarding replay onClose={() => setWelcome(false)} />}
      <button type="button" className="kms-reset" onClick={() => void resetMobile()}><RotateCcw size={17} /> {copy('Reset mobile settings', 'إعادة ضبط الإعدادات')}</button>
    </section>
  );
};
