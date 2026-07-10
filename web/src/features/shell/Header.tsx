import {
  ArrowsInSimple,
  ArrowsOutSimple,
  CornersIn,
  CornersOut,
  GearSix,
} from "@phosphor-icons/react";
import { IconButton } from "../../components/IconButton";
import { WorldSwitcher } from "./WorldSwitcher";
import { TID } from "../../testids";
import styles from "./Header.module.css";

export function Header({
  onOpenSettings,
  onToggleFocus,
  onToggleFullscreen,
  isFocusMode,
  isFullscreen,
  isFullscreenSupported,
}: {
  onOpenSettings: () => void;
  onToggleFocus: () => void;
  onToggleFullscreen: () => void;
  isFocusMode: boolean;
  isFullscreen: boolean;
  isFullscreenSupported: boolean;
}) {
  const focusLabel = isFocusMode ? "Exit focus mode" : "Enter focus mode";
  const fullscreenLabel = isFullscreen
    ? "Exit fullscreen"
    : isFullscreenSupported
      ? "Enter fullscreen"
      : "Fullscreen unavailable in this browser";

  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <span className={styles.logo}>Annales</span>
      </div>
      <div className={styles.centerControls}>
        <IconButton
          label="World settings"
          onClick={onOpenSettings}
          data-testid={TID.settingsButton}>
          <GearSix size={18} />
        </IconButton>
        <WorldSwitcher />
      </div>
      <div className={styles.right}>
        <IconButton
          label={focusLabel}
          onClick={onToggleFocus}
          active={isFocusMode}
          aria-pressed={isFocusMode}
          data-testid={TID.focusButton}>
          {isFocusMode ? <CornersIn size={18} /> : <CornersOut size={18} />}
        </IconButton>
        <IconButton
          label={fullscreenLabel}
          onClick={onToggleFullscreen}
          active={isFullscreen}
          aria-pressed={isFullscreen}
          disabled={!isFullscreenSupported}
          data-testid={TID.fullscreenButton}>
          {isFullscreen ? <ArrowsInSimple size={18} /> : <ArrowsOutSimple size={18} />}
        </IconButton>
      </div>
    </header>
  );
}
