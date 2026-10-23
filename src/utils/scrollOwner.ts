/**
 * Android screens own their vertical scroll container.
 *
 * On the Capacitor shell the document never scrolls: `html`, `body`, `#root`,
 * `.app-shell`, `.app-body`, `.main-content` and `.view-transition` are all
 * clipped, and the screen element (`.audio-tools-view`, `.knoux-mobile-home`,
 * `.knoux-mobile-creative-surface`, …) is the only thing that scrolls. A
 * `window.scrollTo()` call from inside such a screen therefore does nothing at
 * all — the UI looks responsive while the content stays put.
 *
 * These helpers resolve the real scroll owner from a DOM node so programmatic
 * scrolling works on Android, on the desktop shell (where an ancestor scrolls)
 * and in a plain browser preview (where the window scrolls) without a
 * platform-specific branch at every call site.
 */

function scrollsVertically(node: HTMLElement): boolean {
  const { overflowY } = window.getComputedStyle(node);
  if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay') return false;
  // A scrollable style on a container that already fits its content is not the
  // owner; falling through keeps the search honest on short screens.
  return node.scrollHeight - node.clientHeight > 1;
}

/** Nearest element, starting at `from` itself, that can actually scroll vertically. */
export function findVerticalScrollOwner(from: HTMLElement | null): HTMLElement | null {
  for (let node = from; node; node = node.parentElement) {
    if (scrollsVertically(node)) return node;
  }
  return null;
}

/**
 * Scrolls the container that owns `from` back to its top, falling back to the
 * window only when no element in the chain is scrollable.
 */
export function scrollToTopWithin(from: HTMLElement | null, behavior: ScrollBehavior = 'smooth'): void {
  const owner = findVerticalScrollOwner(from);
  if (owner) {
    owner.scrollTo({ top: 0, behavior });
    return;
  }
  window.scrollTo({ top: 0, behavior });
}

/**
 * Brings `target` to the top of its own scroll container. `scrollIntoView` is
 * only used when the target has no resolvable container owner, because on the
 * mobile shell it can also nudge unrelated ancestors.
 */
export function scrollTargetToTop(target: HTMLElement | null, behavior: ScrollBehavior = 'smooth'): void {
  if (!target) return;
  const owner = findVerticalScrollOwner(target.parentElement);
  if (!owner) {
    target.scrollIntoView({ block: 'start', behavior });
    return;
  }
  const ownerTop = owner.getBoundingClientRect().top;
  const targetTop = target.getBoundingClientRect().top;
  owner.scrollTo({ top: owner.scrollTop + (targetTop - ownerTop), behavior });
}
