export function hasCoreDesktopBridge(): boolean {
  return typeof window !== 'undefined'
    && window.knouxRuntime?.edition === 'desktop'
    && typeof window.knouxAPI === 'object'
    && window.knouxAPI !== null;
}

export function hasCreativeDesktopBridge(): boolean {
  return typeof window !== 'undefined'
    && window.knouxRuntime?.edition === 'desktop'
    && typeof window.knouxCreativeAPI === 'object'
    && window.knouxCreativeAPI !== null;
}

export function isDesktopRuntime(): boolean {
  return hasCoreDesktopBridge() && hasCreativeDesktopBridge();
}

export function isBrowserPreviewRuntime(): boolean {
  return typeof window !== 'undefined'
    && window.knouxRuntime?.edition === 'web-preview'
    && document.documentElement.dataset.runtime === 'web-preview';
}
