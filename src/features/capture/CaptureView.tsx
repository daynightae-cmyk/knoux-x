import React, { useCallback, useEffect, useState } from 'react';
import { Camera, FolderOpen, RefreshCw } from 'lucide-react';

import { NeonButton } from '../../components/neon/NeonButton';
import { NeonPanel } from '../../components/neon/NeonPanel';

export const CaptureView: React.FC = () => {
  const [captures, setCaptures] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCaptures(await window.knouxAPI.capture.getRecent());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load capture history.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <section className="creative-view" aria-labelledby="capture-title">
      <header className="creative-header">
        <div>
          <span className="creative-eyebrow">KNOUX Creative Suite</span>
          <h1 id="capture-title"><Camera size={30} /> Frame Capture</h1>
          <p>Capture original-resolution frames from the Player, copy them to the clipboard, and manage recent output.</p>
        </div>
        <NeonButton variant="secondary" leftIcon={<RefreshCw size={16} />} onClick={() => void refresh()}>
          Refresh
        </NeonButton>
      </header>

      {error && <div className="creative-error" role="alert">{error}</div>}

      <NeonPanel variant="dark" padding="lg">
        <div className="creative-empty-hint">
          <Camera size={34} />
          <div>
            <strong>Use the camera button inside Player</strong>
            <span>The current video frame is rendered from the media element, not from a low-quality window screenshot.</span>
          </div>
        </div>
      </NeonPanel>

      <div className="creative-section-heading">
        <h2>Recent captures</h2>
        <span>{captures.length} item{captures.length === 1 ? '' : 's'}</span>
      </div>

      {loading ? (
        <div className="creative-loading">Loading capture history…</div>
      ) : captures.length === 0 ? (
        <div className="creative-empty">No captures have been saved yet.</div>
      ) : (
        <div className="capture-grid">
          {captures.map((filePath) => (
            <NeonPanel key={filePath} variant="dark" padding="sm">
              <div className="capture-card">
                <div className="capture-path" title={filePath}>{filePath.split(/[\\/]/).pop()}</div>
                <NeonButton
                  variant="ghost"
                  size="sm"
                  leftIcon={<FolderOpen size={14} />}
                  onClick={() => void window.knouxAPI.capture.showItem(filePath)}
                >
                  Show in folder
                </NeonButton>
              </div>
            </NeonPanel>
          ))}
        </div>
      )}
    </section>
  );
};
