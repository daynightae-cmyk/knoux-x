export {};

declare global {
  interface Window {
    knouxRuntime?: Readonly<{
      edition: 'desktop' | 'web-preview';
      product: 'KNOUX Player X';
      bridgeVersion: number;
    }>;
  }
}
