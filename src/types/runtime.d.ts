import type { Sprint02CommandRuntime } from '../core/commands/sprint02CommandSystem';

declare global {
  interface Window {
    __knouxSprint02?: Sprint02CommandRuntime;
    knouxRuntime?: Readonly<{
      edition: 'desktop' | 'web-preview';
      product: 'KNOUX Player X';
      bridgeVersion: number;
    }>;
  }
}
