import { useCallback, useEffect, useMemo, useState } from "react";
import type { RefObject } from "react";

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  mozRequestFullScreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  mozFullScreenElement?: Element | null;
  msFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  mozFullScreenEnabled?: boolean;
  msFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
  mozCancelFullScreen?: () => Promise<void> | void;
  msExitFullscreen?: () => Promise<void> | void;
};

function getFullscreenElement(doc: FullscreenDocument): Element | null {
  return (
    doc.fullscreenElement ??
    doc.webkitFullscreenElement ??
    doc.mozFullScreenElement ??
    doc.msFullscreenElement ??
    null
  );
}

export function useFullscreen(targetRef: RefObject<HTMLElement>) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const isSupported = useMemo(() => {
    if (typeof document === "undefined") {
      return false;
    }
    const doc = document as FullscreenDocument;
    return Boolean(
      doc.fullscreenEnabled ??
      doc.webkitFullscreenEnabled ??
      doc.mozFullScreenEnabled ??
      doc.msFullscreenEnabled
    );
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const doc = document as FullscreenDocument;
    const sync = () => setIsFullscreen(Boolean(getFullscreenElement(doc)));

    sync();
    doc.addEventListener("fullscreenchange", sync);
    doc.addEventListener("webkitfullscreenchange", sync as EventListener);
    doc.addEventListener("mozfullscreenchange", sync as EventListener);
    doc.addEventListener("MSFullscreenChange", sync as EventListener);

    return () => {
      doc.removeEventListener("fullscreenchange", sync);
      doc.removeEventListener("webkitfullscreenchange", sync as EventListener);
      doc.removeEventListener("mozfullscreenchange", sync as EventListener);
      doc.removeEventListener("MSFullscreenChange", sync as EventListener);
    };
  }, []);

  const enterFullscreen = useCallback(async () => {
    if (!isSupported || typeof document === "undefined") {
      return false;
    }

    const el = targetRef.current as FullscreenElement | null;
    if (!el) {
      return false;
    }

    if (el.requestFullscreen) {
      await el.requestFullscreen();
      return true;
    }
    if (el.webkitRequestFullscreen) {
      await el.webkitRequestFullscreen();
      return true;
    }
    if (el.mozRequestFullScreen) {
      await el.mozRequestFullScreen();
      return true;
    }
    if (el.msRequestFullscreen) {
      await el.msRequestFullscreen();
      return true;
    }

    return false;
  }, [isSupported, targetRef]);

  const exitFullscreen = useCallback(async () => {
    if (!isSupported || typeof document === "undefined") {
      return false;
    }

    const doc = document as FullscreenDocument;

    if (doc.exitFullscreen) {
      await doc.exitFullscreen();
      return true;
    }
    if (doc.webkitExitFullscreen) {
      await doc.webkitExitFullscreen();
      return true;
    }
    if (doc.mozCancelFullScreen) {
      await doc.mozCancelFullScreen();
      return true;
    }
    if (doc.msExitFullscreen) {
      await doc.msExitFullscreen();
      return true;
    }

    return false;
  }, [isSupported]);

  return {
    isSupported,
    isFullscreen,
    enterFullscreen,
    exitFullscreen,
  };
}
