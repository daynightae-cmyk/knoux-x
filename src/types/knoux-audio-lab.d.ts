import type { AudioProbeSummary } from '../core/creative/audioTools';
import type {
  AudioLabJobExtras,
  AudioLabMergeRequest,
  AudioSilenceRange,
} from '../core/creative/audioLab';
import type { AudioToolJobSnapshot } from '../../electron/creative/audio-tools-service';

declare global {
  interface Window {
    /** Android-only extensions installed by the same audio tools bridge. */
    knouxAudioLabAPI?: {
      merge(request: AudioLabMergeRequest): Promise<(AudioToolJobSnapshot & AudioLabJobExtras) | null>;
      analyzeSilence(
        sourcePath: string,
        thresholdDb?: number,
        minimumSilence?: number,
      ): Promise<{ summary: AudioProbeSummary; ranges: AudioSilenceRange[] }>;
    };
  }
}

export {};
