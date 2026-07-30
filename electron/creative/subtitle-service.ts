import fs from 'fs/promises';
import path from 'path';

import { dialog } from 'electron';

import { convertSubtitleToWebVtt, parseSubtitleText } from '../../src/core/subtitles/subtitle';

const MAX_SUBTITLE_BYTES = 10 * 1024 * 1024;

export interface LoadedSubtitle {
  filePath: string;
  name: string;
  cueCount: number;
  delaySeconds: number;
  webVtt: string;
}

export class SubtitleService {
  async select(delaySeconds = 0): Promise<LoadedSubtitle | null> {
    const result = await dialog.showOpenDialog({
      title: 'Open subtitles',
      filters: [{ name: 'Subtitle Files', extensions: ['srt', 'vtt'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return this.load(result.filePaths[0], delaySeconds);
  }

  async load(filePath: string, delaySeconds = 0): Promise<LoadedSubtitle> {
    const resolved = path.resolve(filePath);
    const extension = path.extname(resolved).toLowerCase();
    if (extension !== '.srt' && extension !== '.vtt') throw new TypeError('Only SRT and VTT subtitles are supported.');
    const stats = await fs.stat(resolved);
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_SUBTITLE_BYTES) {
      throw new RangeError('Subtitle file is empty or exceeds 10 MB.');
    }
    const source = await fs.readFile(resolved, 'utf8');
    const cues = parseSubtitleText(source);
    if (cues.length === 0) throw new Error('No valid subtitle cues were found.');
    return {
      filePath: resolved,
      name: path.basename(resolved),
      cueCount: cues.length,
      delaySeconds,
      webVtt: convertSubtitleToWebVtt(source, delaySeconds),
    };
  }
}
