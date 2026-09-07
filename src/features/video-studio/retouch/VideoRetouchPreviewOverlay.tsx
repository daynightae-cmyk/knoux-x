import { useCallback, useEffect, useRef } from 'react';

import type { TimelineItem } from '../../../core/creative/multitrackProject';
import { VideoFrameProcessor } from '../../image-editor/retouch/RetouchModule/Media/VideoFrameProcessor';
import './videoRetouch.css';

export interface VideoRetouchPreviewOverlayProps {
  item: TimelineItem;
  mediaRef: React.RefObject<HTMLVideoElement | HTMLAudioElement | null>;
  playhead: number;
}

const PREVIEW_SCALE = 0.25;
const MAX_PREVIEW_EDGE = 720;

function previewDimensions(width: number, height: number): { width: number; height: number } {
  let scale = PREVIEW_SCALE;
  if (Math.max(width * scale, height * scale) > MAX_PREVIEW_EDGE) scale = MAX_PREVIEW_EDGE / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** 25%-resolution frame preview; all heavy model analysis stays outside the UI frame loop. */
export const VideoRetouchPreviewOverlay: React.FC<VideoRetouchPreviewOverlayProps> = ({ item, mediaRef, playhead }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const proxyRef = useRef<HTMLCanvasElement | null>(null);
  const processorRef = useRef(new VideoFrameProcessor());
  const animationRef = useRef<number | null>(null);
  const renderingRef = useRef(false);

  const renderFrame = useCallback((): void => {
    if (renderingRef.current) return;
    const media = mediaRef.current;
    const canvas = canvasRef.current;
    if (!(media instanceof HTMLVideoElement) || !canvas || media.readyState < media.HAVE_CURRENT_DATA || media.videoWidth < 1 || media.videoHeight < 1) return;
    renderingRef.current = true;
    try {
      const dimensions = previewDimensions(media.videoWidth, media.videoHeight);
      const proxy = proxyRef.current ?? document.createElement('canvas');
      proxyRef.current = proxy;
      if (proxy.width !== dimensions.width) proxy.width = dimensions.width;
      if (proxy.height !== dimensions.height) proxy.height = dimensions.height;
      const context = proxy.getContext('2d', { alpha: false, willReadFrequently: true });
      if (!context) return;
      context.drawImage(media, 0, 0, dimensions.width, dimensions.height);
      const frame = context.getImageData(0, 0, dimensions.width, dimensions.height);
      const localTime = Math.max(0, Math.min(item.duration, playhead - item.timelineStart));
      const result = processorRef.current.process(frame, item.retouch, localTime, { respectBeforeAfter: true });
      context.putImageData(result.imageData, 0, 0);
      if (canvas.width !== dimensions.width) canvas.width = dimensions.width;
      if (canvas.height !== dimensions.height) canvas.height = dimensions.height;
      const display = canvas.getContext('2d', { alpha: true });
      if (!display) return;
      display.clearRect(0, 0, dimensions.width, dimensions.height);
      display.drawImage(proxy, 0, 0);
    } finally {
      renderingRef.current = false;
    }
  }, [item, mediaRef, playhead]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!(media instanceof HTMLVideoElement)) return undefined;
    const tick = (): void => {
      renderFrame();
      if (!media.paused && !media.ended) animationRef.current = requestAnimationFrame(tick);
    };
    const start = (): void => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      animationRef.current = requestAnimationFrame(tick);
    };
    const once = (): void => renderFrame();
    media.addEventListener('play', start);
    media.addEventListener('seeked', once);
    media.addEventListener('loadeddata', once);
    renderFrame();
    return () => {
      media.removeEventListener('play', start);
      media.removeEventListener('seeked', once);
      media.removeEventListener('loadeddata', once);
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    };
  }, [mediaRef, renderFrame]);

  useEffect(() => {
    renderFrame();
  }, [item.retouch, playhead, renderFrame]);

  useEffect(() => () => processorRef.current.clearCache(), []);

  if (!item.retouch?.enabled || item.kind !== 'video') return null;
  return <canvas ref={canvasRef} className="video-retouch-preview-overlay" aria-label="Video Retouch preview" />;
};
