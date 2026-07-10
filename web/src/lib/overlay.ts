export function getOverlayContainer(): HTMLElement | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }

  const fullscreenRoot = document.fullscreenElement;
  if (fullscreenRoot instanceof HTMLElement) {
    return fullscreenRoot;
  }

  const shellRoot = document.querySelector('[data-overlay-root="shell"]');
  if (shellRoot instanceof HTMLElement) {
    return shellRoot;
  }

  return undefined;
}
