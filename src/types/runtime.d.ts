import type { Sprint02CommandRuntime } from '../core/commands/sprint02CommandSystem';

declare global {
  interface Window {
    __knouxSprint02?: Sprint02CommandRuntime;
    Capacitor?: Readonly<{
      getPlatform?: () => string;
      isNativePlatform?: () => boolean;
    }>;
    knouxRuntime?: Readonly<{
      edition: 'desktop' | 'web-preview' | 'android';
      product: 'KNOUX Player X';
      bridgeVersion: number;
    }>;
  }
}
