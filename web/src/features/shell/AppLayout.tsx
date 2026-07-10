// Four-region shell: header / mode rail / resizable sidebar / body. The
// sidebar snaps closed below its minimum width (react-resizable-panels
// collapsible); an edge button restores it. Panel sizes persist to
// localStorage via autoSaveId — device-local by design, unlike tab state
// which lives in WorkspaceState.

import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { CaretRight } from "@phosphor-icons/react";
import { Header } from "./Header";
import { ModeRail } from "./ModeRail";
import { TID } from "../../testids";
import { useFullscreen } from "../../lib/useFullscreen";
import { ShellChromeContext } from "./ShellChromeContext";
import styles from "./AppLayout.module.css";

export function AppLayout({
  sidebar,
  body,
  onOpenSettings,
}: {
  sidebar: ReactNode;
  body: ReactNode;
  onOpenSettings: () => void;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<ImperativePanelHandle>(null);
  const sidebarWasExpandedBeforeFocusRef = useRef(false);
  const [collapsed, setCollapsed] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const {
    isFullscreen,
    isSupported: isFullscreenSupported,
    enterFullscreen,
    exitFullscreen,
  } = useFullscreen(shellRef);

  const handleToggleFocus = () => {
    setIsFocusMode((prev) => {
      if (!prev) {
        sidebarWasExpandedBeforeFocusRef.current = !collapsed;
        if (!collapsed) {
          sidebarRef.current?.collapse();
        }
        return true;
      }

      if (sidebarWasExpandedBeforeFocusRef.current) {
        sidebarRef.current?.expand();
      }
      sidebarWasExpandedBeforeFocusRef.current = false;
      return false;
    });
  };

  const handleToggleFullscreen = async () => {
    if (!isFullscreenSupported) {
      return;
    }
    if (isFullscreen) {
      await exitFullscreen();
      return;
    }
    await enterFullscreen();
  };

  return (
    <ShellChromeContext.Provider
      value={{
        isFocusMode,
        isFullscreen,
        isFullscreenSupported,
        toggleFocus: handleToggleFocus,
        toggleFullscreen: handleToggleFullscreen,
      }}>
      <div
        ref={shellRef}
        className={[styles.shell, isFocusMode ? styles.focusMode : ""].filter(Boolean).join(" ")}>
        {!isFocusMode && (
          <Header
            onOpenSettings={onOpenSettings}
            onToggleFocus={handleToggleFocus}
            onToggleFullscreen={handleToggleFullscreen}
            isFocusMode={isFocusMode}
            isFullscreen={isFullscreen}
            isFullscreenSupported={isFullscreenSupported}
          />
        )}
        <div className={styles.row}>
          <div className={styles.rail}>
            <ModeRail />
          </div>
          <PanelGroup direction="horizontal" autoSaveId="sheaf-layout" className={styles.panels}>
            <Panel
              ref={sidebarRef}
              collapsible
              collapsedSize={0}
              minSize={16}
              maxSize={45}
              defaultSize={26}
              onCollapse={() => setCollapsed(true)}
              onExpand={() => setCollapsed(false)}
              className={styles.sidebarPanel}>
              {sidebar}
            </Panel>
            <PanelResizeHandle
              className={styles.resizeHandle}
              data-testid={TID.sidebarResizeHandle}
            />
            <Panel className={styles.bodyPanel}>
              {collapsed && (
                <button
                  type="button"
                  className={styles.expandButton}
                  onClick={() => sidebarRef.current?.expand()}
                  aria-label="Show sidebar"
                  data-testid={TID.sidebarExpand}>
                  <CaretRight size={14} />
                </button>
              )}
              {body}
            </Panel>
          </PanelGroup>
        </div>
      </div>
    </ShellChromeContext.Provider>
  );
}
