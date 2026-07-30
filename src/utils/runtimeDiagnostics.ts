export interface RuntimeDiagnostics {
  capturedAt: string;
  online: boolean;
  platform: string;
  locale: string;
  timezone: string;
  viewport: string;
  screen: string;
  pixelRatio: number;
  cpuThreads: number | null;
  deviceMemoryGB: number | null;
  heapUsedMB: number | null;
  heapLimitMB: number | null;
  userAgent: string;
}

interface NavigatorWithMemory extends Navigator {
  deviceMemory?: number;
}

interface PerformanceMemory {
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface PerformanceWithMemory extends Performance {
  memory?: PerformanceMemory;
}

function bytesToMegabytes(value: number): number {
  return Math.round((value / 1024 / 1024) * 10) / 10;
}

export function collectRuntimeDiagnostics(): RuntimeDiagnostics {
  const extendedNavigator = navigator as NavigatorWithMemory;
  const extendedPerformance = performance as PerformanceWithMemory;
  const memory = extendedPerformance.memory;

  return {
    capturedAt: new Date().toISOString(),
    online: navigator.onLine,
    platform: navigator.platform || 'Unknown',
    locale: navigator.language || 'Unknown',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown',
    viewport: `${window.innerWidth} × ${window.innerHeight}`,
    screen: `${window.screen.width} × ${window.screen.height}`,
    pixelRatio: window.devicePixelRatio,
    cpuThreads: navigator.hardwareConcurrency || null,
    deviceMemoryGB: extendedNavigator.deviceMemory ?? null,
    heapUsedMB: memory ? bytesToMegabytes(memory.usedJSHeapSize) : null,
    heapLimitMB: memory ? bytesToMegabytes(memory.jsHeapSizeLimit) : null,
    userAgent: navigator.userAgent,
  };
}
