import React, { useCallback } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ListMusic,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Shuffle,
  Trash2,
  X,
} from 'lucide-react';

import { NeonButton } from '../../components/neon/NeonButton';
import { NeonPanel } from '../../components/neon/NeonPanel';
import { useTranslation } from '../../i18n';
import { useAppStore } from '../../store/appStore';
import { usePlayerStore } from '../../store/playerStore';
import type { RepeatMode } from '../../core/player/queue';

export const QueueView: React.FC = () => {
  const {
    playlist,
    currentIndex,
    currentMedia,
    repeatMode,
    shuffle,
    addToQueue,
    removeFromQueue,
    reorderQueue,
    clearQueue,
    selectQueueIndex,
    setRepeatMode,
    toggleShuffle,
  } = usePlayerStore();
  const setView = useAppStore((state) => state.setView);
  const { t } = useTranslation();

  const addMedia = useCallback(async (): Promise<void> => {
    const selected = await window.knouxCreativeAPI.media.open();
    if (!selected) return;
    addToQueue(selected.filePath);
  }, [addToQueue]);

  const playIndex = useCallback((index: number): void => {
    selectQueueIndex(index);
    setView('player');
  }, [selectQueueIndex, setView]);

  const repeatOptions: Array<{ mode: RepeatMode; label: string; icon: React.ReactNode }> = [
    { mode: 'off', label: t('queue.repeatOff'), icon: <Repeat size={15} /> },
    { mode: 'one', label: t('queue.repeatOne'), icon: <Repeat1 size={15} /> },
    { mode: 'all', label: t('queue.repeatAll'), icon: <Repeat size={15} /> },
  ];

  return (
    <section className="creative-view queue-view" aria-labelledby="queue-title">
      <header className="creative-header">
        <div>
          <span className="creative-eyebrow">{t('queue.eyebrow')}</span>
          <h1 id="queue-title"><ListMusic size={30} /> {t('queue.title')}</h1>
          <p>{t('queue.description')}</p>
        </div>
        <div className="creative-actions">
          <NeonButton variant="primary" leftIcon={<Plus size={16} />} onClick={() => void addMedia()}>
            {t('queue.addMedia')}
          </NeonButton>
          <NeonButton variant="ghost" leftIcon={<Trash2 size={16} />} onClick={clearQueue} disabled={playlist.length === 0}>
            {t('queue.clear')}
          </NeonButton>
        </div>
      </header>

      <NeonPanel variant="dark" padding="md">
        <div className="queue-options" aria-label={t('queue.playbackOptions')}>
          <div className="queue-repeat-options">
            {repeatOptions.map((option) => (
              <button
                key={option.mode}
                type="button"
                className={repeatMode === option.mode ? 'active' : ''}
                onClick={() => setRepeatMode(option.mode)}
                aria-pressed={repeatMode === option.mode}
              >
                {option.icon}<span>{option.label}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className={shuffle ? 'active' : ''}
            onClick={toggleShuffle}
            aria-pressed={shuffle}
          >
            <Shuffle size={16} /><span>{t('queue.shuffle')}</span>
          </button>
          <span>{playlist.length} {t('common.items')}</span>
        </div>
      </NeonPanel>

      {playlist.length === 0 ? (
        <NeonPanel variant="dark" padding="lg">
          <div className="creative-empty-hint">
            <ListMusic size={42} />
            <div>
              <strong>{t('queue.emptyTitle')}</strong>
              <span>{t('queue.emptyDescription')}</span>
            </div>
          </div>
        </NeonPanel>
      ) : (
        <div className="queue-list" role="list">
          {playlist.map((filePath, index) => {
            const active = index === currentIndex || filePath === currentMedia;
            const title = filePath.split(/[\\/]/).pop() ?? filePath;
            return (
              <NeonPanel key={`${index}:${filePath}`} variant="dark" padding="sm" className={active ? 'queue-item active' : 'queue-item'}>
                <div role="listitem" className="queue-item-content">
                  <button
                    type="button"
                    className="queue-play"
                    onClick={() => playIndex(index)}
                    aria-label={`${t('queue.play')} ${title}`}
                  >
                    <Play size={18} />
                  </button>
                  <div className="queue-index" aria-hidden="true">{index + 1}</div>
                  <div className="queue-item-label" title={filePath}>
                    <strong dir="auto">{title}</strong>
                    <span dir="auto">{filePath}</span>
                    {active && <small>{t('queue.current')}</small>}
                  </div>
                  <div className="queue-item-actions">
                    <button
                      type="button"
                      onClick={() => reorderQueue(index, index - 1)}
                      disabled={index === 0}
                      aria-label={t('queue.moveUp')}
                      title={t('queue.moveUp')}
                    >
                      <ArrowUp size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => reorderQueue(index, index + 1)}
                      disabled={index === playlist.length - 1}
                      aria-label={t('queue.moveDown')}
                      title={t('queue.moveDown')}
                    >
                      <ArrowDown size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeFromQueue(filePath)}
                      aria-label={t('queue.remove')}
                      title={t('queue.remove')}
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>
              </NeonPanel>
            );
          })}
        </div>
      )}
    </section>
  );
};
