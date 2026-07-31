export function hasCoreDesktopBridge(): boolean {
  return typeof window !== 'undefined'
    && document.documentElement.dataset.runtime === 'electron'
    && typeof window.knouxAPI === 'object'
    && window.knouxAPI !== null;
}

export function hasCreativeDesktopBridge(): boolean {
  return typeof window !== 'undefined'
    && document.documentElement.dataset.runtime === 'electron'
    && typeof window.knouxCreativeAPI === 'object'
    && window.knouxCreativeAPI !== null;
}

export function isDesktopRuntime(): boolean {
  return hasCoreDesktopBridge() && hasCreativeDesktopBridge();
}

export function isBrowserPreviewRuntime(): boolean {
  return typeof window !== 'undefined'
    && document.documentElement.dataset.runtime === 'web-preview';
}
