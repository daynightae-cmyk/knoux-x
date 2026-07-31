import React, { useCallback, useEffect, useState } from 'react';
import { Camera, FolderCog, FolderOpen, RefreshCw } from 'lucide-react';

import { NeonButton } from '../../components/neon/NeonButton';
import { NeonPanel } from '../../components/neon/NeonPanel';
import { useTranslation } from '../../i18n';

export const CaptureView: React.FC = () => {
  const [captures, setCaptures] = useState<string[]>([]);
  const [defaultDirectory, setDefaultDirectory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [nextCaptures, directory] = await Promise.all([
        window.knouxCreativeAPI.capture.getRecent(),
        window.knouxCreativeAPI.capture.getDefaultDirectory(),
      ]);
      setCaptures(nextCaptures);
      setDefaultDirectory(directory);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('capture.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void refresh(); }, [refresh]);

  const chooseDirectory = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const directory = await window.knouxCreativeAPI.capture.chooseDefaultDirectory();
      if (directory) setDefaultDirectory(directory);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('capture.folderFailed'));
    }
  }, [t]);

  return (
    <section className="creative-view" aria-labelledby="capture-title">
      <header className="creative-header">
        <div>
          <span className="creative-eyebrow">{t('capture.eyebrow')}</span>
          <h1 id="capture-title"><Camera size={30} /> {t('capture.title')}</h1>
          <p>{t('capture.description')}</p>
        </div>
        <div className="creative-actions">
          <NeonButton variant="ghost" leftIcon={<FolderCog size={16} />} onClick={() => void chooseDirectory()}>
            {t('capture.folder')}
          </NeonButton>
          <NeonButton variant="secondary" leftIcon={<RefreshCw size={16} />} onClick={() => void refresh()}>
            {t('common.refresh')}
          </NeonButton>
        </div>
      </header>

      {error && <div className="creative-error" role="alert">{error}</div>}

      <NeonPanel variant="dark" padding="lg">
        <div className="creative-empty-hint">
          <Camera size={34} />
          <div>
            <strong>{t('capture.hintTitle')}</strong>
            <span>{t('capture.hintDescription')}</span>
            <span className="capture-path" title={defaultDirectory ?? undefined} dir="auto">
              {defaultDirectory
                ? `${t('capture.defaultFolder')}: ${defaultDirectory}`
                : t('capture.chooseOnFirst')}
            </span>
          </div>
        </div>
      </NeonPanel>

      <div className="creative-section-heading">
        <h2>{t('capture.recent')}</h2>
        <span>{captures.length} {t('common.items')}</span>
      </div>

      {loading ? (
        <div className="creative-loading">{t('capture.loading')}</div>
      ) : captures.length === 0 ? (
        <div className="creative-empty">{t('capture.empty')}</div>
      ) : (
        <div className="capture-grid">
          {captures.map((filePath) => (
            <NeonPanel key={filePath} variant="dark" padding="sm">
              <div className="capture-card">
                <div className="capture-path" title={filePath} dir="auto">{filePath.split(/[\\/]/).pop()}</div>
                <NeonButton
                  variant="ghost"
                  size="sm"
                  leftIcon={<FolderOpen size={14} />}
                  onClick={() => void window.knouxCreativeAPI.capture.showItem(filePath)}
                >
                  {t('capture.showFolder')}
                </NeonButton>
              </div>
            </NeonPanel>
          ))}
        </div>
      )}
    </section>
  );
};
