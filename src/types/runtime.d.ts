import type { Sprint02CommandRuntime } from '../core/commands/sprint02CommandSystem';

declare global {
  interface Window {
    __knouxSprint02?: Sprint02CommandRuntime;
    Capacitor?: Readonly<{
      getPlatform?: () => string;
      isNativePlatform?: () => boolean;
      Plugins?: Readonly<{
        KnouxMediaSession?: {
          enterPictureInPicture(options: { width: number; height: number }): Promise<{ entered?: boolean }>;
          updatePlayback(options: {
            title: string;
            playing: boolean;
            position: number;
            duration: number;
          }): Promise<{ active?: boolean }>;
          stopPlayback(): Promise<{ active?: boolean }>;
        };
      }>;
    }>;
    knouxRuntime?: Readonly<{
      edition: 'desktop' | 'web-preview' | 'android';
      product: 'KNOUX Player X';
      bridgeVersion: number;
    }>;
  }
}
