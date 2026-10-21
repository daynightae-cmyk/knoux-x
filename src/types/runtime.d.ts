import type { Sprint02CommandRuntime } from '../core/commands/sprint02CommandSystem';
import type { MediaStoreMethods } from '../platform/androidMediaStore';
import type { VaultMethods } from '../platform/androidVault';

declare global {
  interface Window {
    __knouxSprint02?: Sprint02CommandRuntime;
    Capacitor?: Readonly<{
      getPlatform?: () => string;
      isNativePlatform?: () => boolean;
      convertFileSrc?: (path: string) => string;
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
        KnouxSaf?: MediaStoreMethods & {          pick(options: {
            mode: 'file' | 'files' | 'directory' | 'save';
            mimeTypes?: string[];
            suggestedName?: string;
          }): Promise<{ items?: Array<{ uri: string; name: string; mime: string; size: number }> }>;
          readBytes(options: { uri: string }): Promise<{ base64: string }>;
          writeBytes(options: { uri: string; base64: string }): Promise<{ written: number }>;
          exists(options: { uri: string }): Promise<{ exists: boolean }>;
          delete(options: { uri: string }): Promise<{ deleted: boolean }>;
          stat(options: { uri: string }): Promise<{ uri: string; name: string; mime: string; size: number }>;
          metadata(options: { uri: string }): Promise<{
            uri: string;
            name: string;
            mime: string;
            size: number;
            duration?: number;
            width?: number;
            height?: number;
            rotation?: number;
            bitrate?: number;
            frameRate?: number;
          }>;
          listDirectory(options: { uri: string }): Promise<{ items?: Array<{ uri: string; name: string; mime: string; size: number }> }>;
        };
        App?: {
          addListener(
            eventName: 'backButton',
            listenerFunc: (event: { canGoBack?: boolean }) => void,
          ): Promise<{ remove(): Promise<void> }> | { remove(): Promise<void> };
          exitApp(): Promise<void>;
          minimizeApp(): Promise<void>;
        };
        KnouxScreenCapture?: {
          startScreenRecording(options: {
            width: number;
            height: number;
            fps: number;
            bitrate: number;
            microphone: boolean;
          }): Promise<{ recording?: boolean }>;
          stopScreenRecording(): Promise<{ recording?: boolean; outputUri?: string | null }>;
          status(): Promise<{ recording?: boolean; outputUri?: string | null }>;
        };
        KnouxVault?: VaultMethods;
      }>;
    }>;
    knouxRuntime?: Readonly<{
      edition: 'desktop' | 'web-preview' | 'android';
      product: 'Knoux X';
      bridgeVersion: number;
    }>;
  }
}
