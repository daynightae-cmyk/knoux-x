/**
 * KNOUX X update discovery (Settings → About → Updates).
 *
 * Windows packaged builds drive the native electron-updater bridge with
 * explicit user consent at every step. Android and Web consult the public
 * GitHub Release feed: Android opens the approved APK through the system
 * installer flow (Android always confirms sideloaded installs), Web simply
 * reports the deployed version.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';

import { NeonButton } from '../../components/neon/NeonButton';

import { useTranslation } from '../../i18n';
import { getReleaseInfo } from '../../releaseInfo';
import {
  checkManifestForUpdate,
  hasNativeUpdater,
  openReleaseDownload,
  shouldAutoCheck,
  type ReleaseUpdateState,
} from '../../platform/releaseUpdate';

type NativePhase = 'idle' | 'checking' | 'available' | 'current' | 'downloading' | 'downloaded' | 'error' | 'unsupported';

const initialState = (version: string): ReleaseUpdateState => ({
  phase: 'idle',
  currentVersion: version,
  latestVersion: null,
  downloadUrl: null,
  sha256: null,
  detail: null,
  checkedAt: null,
});

export const ReleaseUpdatePanel: React.FC = () => {
  const { t } = useTranslation();
  const release = getReleaseInfo();
  const native = hasNativeUpdater();
  const [state, setState] = useState<ReleaseUpdateState>(() => initialState(release.version));
  const [nativePhase, setNativePhase] = useState<NativePhase>('idle');
  const [nativeVersion, setNativeVersion] = useState<string | null>(null);
  const [nativePercent, setNativePercent] = useState<number | null>(null);
  const [nativeDetail, setNativeDetail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const autoCheckedRef = useRef(false);

  useEffect(() => {
    if (!native) return undefined;
    const off = window.knouxAPI.update.onStatus((status) => {
      setNativePhase(status.phase);
      setNativeVersion(status.version);
      setNativePercent(status.percent);
      setNativeDetail(status.detail);
      setBusy(status.phase === 'checking' || status.phase === 'downloading');
    });
    return off;
  }, [native]);

  const runManifestCheck = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      setState(await checkManifestForUpdate());
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (autoCheckedRef.current || native) return;
    autoCheckedRef.current = true;
    try {
      if (shouldAutoCheck(window.localStorage.getItem('knoux.releaseUpdate.lastCheck'))) {
        void runManifestCheck();
      }
    } catch {
      // Update discovery is best-effort.
    }
  }, [native, runManifestCheck]);

  const runNativeCheck = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      await window.knouxAPI.update.check();
    } catch (reason) {
      setNativePhase('error');
      setNativeDetail(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }, []);

  const phase: string = native ? nativePhase : state.phase;
  const latest: string | null = native ? nativeVersion : state.latestVersion;

  return (
    <div className="about-update-panel" data-component="ReleaseUpdatePanel">
      <dl className="about-grid">
        <div><dt>{t('settings.version')}</dt><dd>{release.version}</dd></div>
        <div><dt>{t('settings.updateBuild')}</dt><dd dir="ltr">{release.shortSha ?? t('settings.updateUnrecorded')}</dd></div>
        <div><dt>{t('settings.updateChannel')}</dt><dd>{release.channel} · stable</dd></div>
        <div>
          <dt>{t('settings.updateLatest')}</dt>
          <dd>{latest ?? '—'}</dd>
        </div>
      </dl>

      {phase === 'available' && latest && (
        <div className="about-update-available" role="status">
          <strong>{t('settings.updateAvailable').replace('{version}', latest)}</strong>
          {!native && state.sha256 && (
            <small dir="ltr">SHA-256 {state.sha256.slice(0, 16)}…</small>
          )}
          {release.channel === 'android' && (
            <small>{t('settings.updateAndroidApproval')}</small>
          )}
        </div>
      )}
      {phase === 'current' && (
        <div className="about-update-current" role="status">{t('settings.updateCurrent')}</div>
      )}
      {(phase === 'error' || (!native && state.phase === 'error')) && (
        <div className="creative-error" role="alert">{native ? nativeDetail : state.detail}</div>
      )}
      {native && nativePhase === 'downloading' && nativePercent !== null && (
        <div className="about-update-progress"><span style={{ width: `${nativePercent}%` }} /><strong>{nativePercent}%</strong></div>
      )}

      <div className="developer-actions">
        {native ? (
          <>
            <NeonButton variant="secondary" leftIcon={<RefreshCw size={15} />} onClick={() => void runNativeCheck()} disabled={busy}>{t('settings.updateCheck')}</NeonButton>
            {nativePhase === 'available' && (
              <NeonButton variant="secondary" leftIcon={<Download size={15} />} onClick={() => void window.knouxAPI.update.download()} disabled={busy}>{t('settings.updateDownload')}</NeonButton>
            )}
            {nativePhase === 'downloaded' && (
              <NeonButton variant="primary" onClick={() => void window.knouxAPI.update.install()}>{t('settings.updateInstall')}</NeonButton>
            )}
          </>
        ) : (
          <>
            <NeonButton variant="secondary" leftIcon={<RefreshCw size={15} />} onClick={() => void runManifestCheck()} disabled={busy}>{t('settings.updateCheck')}</NeonButton>
            {(state.phase === 'available') && (
              <NeonButton variant="secondary" leftIcon={<Download size={15} />} onClick={() => openReleaseDownload(state.downloadUrl)} disabled={busy}>{release.channel === 'android' ? t('settings.updateDownloadApk') : t('settings.updateDownload')}</NeonButton>
            )}
          </>
        )}
      </div>
    </div>
  );
};
