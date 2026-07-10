import { createContext, useContext } from 'react';

export type ShellChromeControls = {
  isFocusMode: boolean;
  isFullscreen: boolean;
  isFullscreenSupported: boolean;
  toggleFocus: () => void;
  toggleFullscreen: () => void;
};

export const ShellChromeContext = createContext<ShellChromeControls | null>(null);

export function useShellChromeControls() {
  return useContext(ShellChromeContext);
}
