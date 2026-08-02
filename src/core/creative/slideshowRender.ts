import {
  effectiveAudioDuration,
  slideTimelineRanges,
  slideshowDuration,
  slideshowOutputSize,
  SLIDESHOW_LIMITS,
  type SlideshowProject,
  type SlideshowSlide,
  type SlideshowTransition,
  type SlideshowWatermark,
} from './slideshowProject';

export type SlideshowRenderFormat = 'mp4' | 'webm' | 'gif';

export interface SlideshowMediaMetadata {
  duration: number;
  hasAudio: boolean;
}

export interface SlideshowRenderAssets {
  slideSources: Record<string, string>;
  slideMetadata: Record<string, SlideshowMediaMetadata>;
  audioMetadata: Record<string, SlideshowMediaMetadata>;
  slideOverlays?: Record<string, string>;
}

export interface SlideshowRenderPlan {
  args: string[];
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  format: SlideshowRenderFormat;
}

function seconds(value: number): string {
  return Math.max(0, value).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function filterNumber(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function xfadeTransition(transition: SlideshowTransition): string {
  if (transition === 'fade-black') return 'fadeblack';
  if (transition === 'wipe') return 'wipeleft';
  if (transition === 'slide') return 'slideleft';
  if (transition === 'zoom') return 'zoomin';
  if (transition === 'blur') return 'fadegrays';
  return 'fade';
}

function watermarkPosition(watermark: SlideshowWatermark): { x: string; y: string } {
  const margin = 24;
  if (watermark.position === 'top-left') return { x: String(margin), y: String(margin) };
  if (watermark.position === 'top-right') return { x: `W-w-${margin}`, y: String(margin) };
  if (watermark.position === 'bottom-left') return { x: String(margin), y: `H-h-${margin}` };
  if (watermark.position === 'center') return { x: '(W-w)/2', y: '(H-h)/2' };
  return { x: `W-w-${margin}`, y: `H-h-${margin}` };
}

function imageMotionFilter(
  slide: SlideshowSlide,
  width: number,
  height: number,
  fps: number
): string {
  const frames = Math.max(1, Math.round(slide.duration * fps));
  const step = filterNumber(0.12 / frames);
  if (slide.kenBurns === 'zoom-in') {
    return `zoompan=z='min(1.12,1+on*${step})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${fps}`;
  }
  if (slide.kenBurns === 'zoom-out') {
    return `zoompan=z='max(1,1.12-on*${step})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${fps}`;
  }
  if (slide.kenBurns === 'pan-left') {
    return `zoompan=z=1.08:x='(iw-iw/zoom)*(1-on/${frames})':y='(ih-ih/zoom)/2':d=${frames}:s=${width}x${height}:fps=${fps}`;
  }
  if (slide.kenBurns === 'pan-right') {
    return `zoompan=z=1.08:x='(iw-iw/zoom)*(on/${frames})':y='(ih-ih/zoom)/2':d=${frames}:s=${width}x${height}:fps=${fps}`;
  }
  if (slide.kenBurns === 'pan-up') {
    return `zoompan=z=1.08:x='(iw-iw/zoom)/2':y='(ih-ih/zoom)*(1-on/${frames})':d=${frames}:s=${width}x${height}:fps=${fps}`;
  }
  if (slide.kenBurns === 'pan-down') {
    return `zoompan=z=1.08:x='(iw-iw/zoom)/2':y='(ih-ih/zoom)*(on/${frames})':d=${frames}:s=${width}x${height}:fps=${fps}`;
  }
  return `fps=${fps}`;
}

function fitFilter(
  slide: SlideshowSlide,
  inputLabel: string,
  outputLabel: string,
  width: number,
  height: number,
  fps: number
): string[] {
  const suffix = `setsar=1,fps=${fps},format=yuv420p,trim=duration=${seconds(slide.duration)},setpts=PTS-STARTPTS`;
  const motion =
    slide.kind === 'image' || slide.kind === 'title' || slide.kind === 'end-card'
      ? `${imageMotionFilter(slide, width, height, fps)},`
      : '';
  if (slide.fit === 'fit') {
    return [
      `${inputLabel}${motion}scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:${slide.backgroundColor},${suffix}${outputLabel}`,
    ];
  }
  if (slide.fit === 'blur-background') {
    const index = outputLabel.replace(/\D/g, '') || '0';
    return [
      `${inputLabel}split=2[bg${index}][fg${index}]`,
      `[bg${index}]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=24:12[blur${index}]`,
      `[fg${index}]${motion}scale=${Math.round(width * slide.cropZoom)}:${Math.round(height * slide.cropZoom)}:force_original_aspect_ratio=decrease[front${index}]`,
      `[blur${index}][front${index}]overlay=(W-w)/2:(H-h)/2,${suffix}${outputLabel}`,
    ];
  }
  return [
    `${inputLabel}${motion}scale=${Math.round(width * slide.cropZoom)}:${Math.round(height * slide.cropZoom)}:force_original_aspect_ratio=increase,crop=${width}:${height}:(iw-ow)*${filterNumber(slide.focalX)}:(ih-oh)*${filterNumber(slide.focalY)},${suffix}${outputLabel}`,
  ];
}

function duckGainExpression(
  musicStart: number,
  gain: number,
  voiceIntervals: Array<{ start: number; end: number }>
): string | null {
  if (voiceIntervals.length === 0) return null;
  const expressions = voiceIntervals.map((interval) => {
    const start = interval.start - musicStart;
    const end = interval.end - musicStart;
    const attackStart = start - SLIDESHOW_LIMITS.duckAttackSeconds;
    const releaseEnd = end + SLIDESHOW_LIMITS.duckReleaseSeconds;
    return `if(between(t,${seconds(attackStart)},${seconds(start)}),1-(1-${filterNumber(gain)})*(t-${seconds(attackStart)})/${seconds(SLIDESHOW_LIMITS.duckAttackSeconds)},if(between(t,${seconds(start)},${seconds(end)}),${filterNumber(gain)},if(between(t,${seconds(end)},${seconds(releaseEnd)}),${filterNumber(gain)}+(1-${filterNumber(gain)})*(t-${seconds(end)})/${seconds(SLIDESHOW_LIMITS.duckReleaseSeconds)},1)))`;
  });
  return expressions.reduce((left, right) => `min(${left},${right})`);
}

function validateAssets(project: SlideshowProject, assets: SlideshowRenderAssets): void {
  for (const slide of project.slides) {
    const source = assets.slideSources[slide.id];
    if (!source || source.includes('\u0000'))
      throw new Error(`Slideshow source is missing for slide ${slide.id}.`);
    const metadata = assets.slideMetadata[slide.id];
    if (!metadata || !Number.isFinite(metadata.duration) || metadata.duration <= 0) {
      throw new Error(`Slideshow metadata is missing for slide ${slide.id}.`);
    }
  }
  for (const track of project.audioTracks) {
    const metadata = assets.audioMetadata[track.id];
    if (!metadata || !Number.isFinite(metadata.duration) || metadata.duration <= 0) {
      throw new Error(`Slideshow audio metadata is missing for track ${track.id}.`);
    }
  }
  if (
    project.watermark &&
    (!project.watermark.sourcePath || project.watermark.sourcePath.includes('\u0000'))
  ) {
    throw new Error('Slideshow watermark source is invalid.');
  }
}

export function buildSlideshowRenderPlan(
  project: SlideshowProject,
  assets: SlideshowRenderAssets,
  outputPath: string,
  format: SlideshowRenderFormat
): SlideshowRenderPlan {
  if (!outputPath || outputPath.includes('\u0000'))
    throw new TypeError('Slideshow output path is invalid.');
  if (project.slides.length === 0) throw new Error('Slideshow requires at least one slide.');
  validateAssets(project, assets);
  const { width, height } = slideshowOutputSize(project);
  const totalDuration = slideshowDuration(project);
  const ranges = slideTimelineRanges(project.slides);
  const args: string[] = ['-hide_banner', '-nostdin', '-y'];
  const filters: string[] = [];
  const slideAudioLabels: string[] = [];
  const trackAudioLabels: string[] = [];
  const slideOverlays = assets.slideOverlays ?? {};
  const overlayInputIndices = new Map<string, number>();

  project.slides.forEach((slide) => {
    const source = assets.slideSources[slide.id];
    if (slide.kind === 'image' || slide.kind === 'title' || slide.kind === 'end-card') {
      args.push(
        '-loop',
        '1',
        '-framerate',
        String(project.fps),
        '-t',
        seconds(slide.duration),
        '-i',
        source
      );
    } else {
      args.push('-ss', seconds(slide.sourceIn), '-t', seconds(slide.duration), '-i', source);
    }
  });

  project.slides.forEach((slide) => {
    const overlay = slideOverlays[slide.id];
    if (!overlay) return;
    overlayInputIndices.set(slide.id, project.slides.length + overlayInputIndices.size);
    args.push(
      '-loop',
      '1',
      '-framerate',
      String(project.fps),
      '-t',
      seconds(slide.duration),
      '-i',
      overlay
    );
  });

  const audioInputOffset = project.slides.length + overlayInputIndices.size;

  project.audioTracks.forEach((track) => {
    const metadata = assets.audioMetadata[track.id];
    const renderDuration = effectiveAudioDuration(track, metadata.duration, totalDuration);
    if (track.loop) args.push('-stream_loop', '-1');
    args.push(
      '-ss',
      seconds(track.sourceIn),
      '-t',
      seconds(renderDuration),
      '-i',
      track.sourcePath
    );
  });

  if (project.watermark) {
    args.push(
      '-loop',
      '1',
      '-framerate',
      String(project.fps),
      '-t',
      seconds(totalDuration),
      '-i',
      project.watermark.sourcePath
    );
  }

  project.slides.forEach((slide, index) => {
    const fittedLabel = `[vf${index}]`;
    filters.push(...fitFilter(slide, `[${index}:v]`, fittedLabel, width, height, project.fps));
    const overlayInputIndex = overlayInputIndices.get(slide.id);
    if (overlayInputIndex !== undefined) {
      filters.push(
        `[${overlayInputIndex}:v]scale=${width}:${height},format=rgba,trim=duration=${seconds(slide.duration)},setpts=PTS-STARTPTS[caption${index}]`
      );
      filters.push(`${fittedLabel}[caption${index}]overlay=0:0:format=auto:shortest=1[v${index}]`);
    } else {
      filters.push(`${fittedLabel}null[v${index}]`);
    }
    const metadata = assets.slideMetadata[slide.id];
    if (slide.kind === 'video' && metadata.hasAudio && !slide.muted && slide.volume > 0) {
      const range = ranges[index];
      const delay = Math.max(0, Math.round(range.start * 1000));
      filters.push(
        `[${index}:a]atrim=start=0:end=${seconds(slide.duration)},asetpts=PTS-STARTPTS,volume=${filterNumber(slide.volume)},adelay=${delay}|${delay}[sa${index}]`
      );
      slideAudioLabels.push(`[sa${index}]`);
    }
  });

  let currentVideoLabel = '[v0]';
  let accumulatedDuration = project.slides[0].duration;
  for (let index = 1; index < project.slides.length; index += 1) {
    const slide = project.slides[index];
    const transition =
      slide.transition === 'none'
        ? 0
        : Math.min(
            slide.transitionDuration,
            slide.duration / 2,
            project.slides[index - 1].duration / 2
          );
    const nextLabel = `[vx${index}]`;
    if (transition > 0) {
      const offset = Math.max(0, accumulatedDuration - transition);
      filters.push(
        `${currentVideoLabel}[v${index}]xfade=transition=${xfadeTransition(slide.transition)}:duration=${seconds(transition)}:offset=${seconds(offset)}${nextLabel}`
      );
      accumulatedDuration += slide.duration - transition;
    } else {
      filters.push(`${currentVideoLabel}[v${index}]concat=n=2:v=1:a=0${nextLabel}`);
      accumulatedDuration += slide.duration;
    }
    currentVideoLabel = nextLabel;
  }

  if (project.watermark) {
    const watermarkInputIndex = audioInputOffset + project.audioTracks.length;
    const watermarkWidth = Math.max(
      16,
      Math.round(width * Math.max(0.02, Math.min(1, project.watermark.scale)))
    );
    const position = watermarkPosition(project.watermark);
    filters.push(
      `[${watermarkInputIndex}:v]scale=${watermarkWidth}:-1,format=rgba,colorchannelmixer=aa=${filterNumber(Math.max(0, Math.min(1, project.watermark.opacity)))},trim=duration=${seconds(totalDuration)},setpts=PTS-STARTPTS[watermark]`
    );
    filters.push(
      `${currentVideoLabel}[watermark]overlay=${position.x}:${position.y}:format=auto:shortest=1[vwatermarked]`
    );
    currentVideoLabel = '[vwatermarked]';
  }

  project.audioTracks.forEach((track, audioIndex) => {
    const inputIndex = audioInputOffset + audioIndex;
    const metadata = assets.audioMetadata[track.id];
    const renderDuration = effectiveAudioDuration(track, metadata.duration, totalDuration);
    const delay = Math.max(0, Math.round(track.start * 1000));
    const chain = [
      `[${inputIndex}:a]atrim=start=0:end=${seconds(renderDuration)}`,
      'asetpts=PTS-STARTPTS',
      `volume=${filterNumber(track.volume)}`,
    ];
    if (track.kind === 'music' && track.duckingEnabled) {
      const voiceIntervals = project.audioTracks
        .filter((candidate) => candidate.kind === 'voice-over')
        .map((candidate) => ({
          start: candidate.start,
          end:
            candidate.start +
            effectiveAudioDuration(
              candidate,
              assets.audioMetadata[candidate.id].duration,
              totalDuration
            ),
        }))
        .filter(
          (interval) => interval.end > track.start && interval.start < track.start + renderDuration
        );
      const duck = duckGainExpression(track.start, track.duckingGain, voiceIntervals);
      if (duck) chain.push(`volume='${duck}':eval=frame`);
    }
    if (track.fadeIn > 0)
      chain.push(`afade=t=in:st=0:d=${seconds(Math.min(track.fadeIn, renderDuration))}`);
    if (track.fadeOut > 0)
      chain.push(
        `afade=t=out:st=${seconds(Math.max(0, renderDuration - track.fadeOut))}:d=${seconds(Math.min(track.fadeOut, renderDuration))}`
      );
    chain.push(`adelay=${delay}|${delay}[aa${audioIndex}]`);
    filters.push(chain.join(','));
    trackAudioLabels.push(`[aa${audioIndex}]`);
  });

  let finalVideoLabel = currentVideoLabel;
  if (format === 'gif') {
    filters.push(`${currentVideoLabel}split[gifbase][gifpalette]`);
    filters.push('[gifpalette]palettegen=max_colors=256[palette]');
    filters.push('[gifbase][palette]paletteuse=dither=sierra2_4a[gifout]');
    finalVideoLabel = '[gifout]';
  }

  // Put full-length timeline tracks first. FFmpeg 6.x amix can terminate at the
  // leading silence boundary when a delayed embedded-video stream is input 0,
  // even with duration=longest. The order does not change the mix, but prevents
  // that premature EOF and keeps AAC padded to the persisted project duration.
  const audioLabels = [...trackAudioLabels, ...slideAudioLabels];
  const hasAudio = format !== 'gif' && audioLabels.length > 0;
  if (hasAudio) {
    filters.push(
      `${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0:normalize=0,apad=whole_dur=${seconds(totalDuration)},atrim=duration=${seconds(totalDuration)},alimiter=limit=0.8913:attack=5:release=50[aout]`
    );
  }

  args.push('-filter_complex', filters.join(';'), '-map', finalVideoLabel);
  if (hasAudio) args.push('-map', '[aout]');
  else args.push('-an');

  if (format === 'mp4') {
    args.push(
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart'
    );
    if (hasAudio) args.push('-c:a', 'aac', '-b:a', '256k');
  } else if (format === 'webm') {
    args.push('-c:v', 'libvpx-vp9', '-crf', '28', '-b:v', '0', '-row-mt', '1');
    if (hasAudio) args.push('-c:a', 'libopus', '-b:a', '192k');
  } else {
    args.push('-loop', '0');
  }
  args.push('-t', seconds(totalDuration), outputPath);

  return {
    args,
    durationSeconds: totalDuration,
    width,
    height,
    fps: project.fps,
    hasAudio,
    format,
  };
}
