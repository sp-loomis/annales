// Full-screen overlay hosting the live Excalidraw editor. Excalidraw is a
// separate lazy chunk; the drawer loads the scene from the presigned download
// URL, and Save serializes → fresh upload slot → PUT → finalize → close.

import { Suspense, lazy, useEffect, useState } from "react";
import { Dialog, VisuallyHidden } from "radix-ui";
import { Button } from "../../../../components/Button";
import { Spinner } from "../../../../components/Spinner";
import { getOverlayContainer } from "../../../../lib/overlay";
import { useArtifact } from "../read/useArtifact";
import { useArtifactUpload } from "./useArtifactUpload";
import { TID } from "../../../../testids";
import styles from "./SketchDrawer.module.css";

const Excalidraw = lazy(() =>
  import("@excalidraw/excalidraw").then((m) => ({ default: m.Excalidraw }))
);

type ExcalidrawAPI = {
  getSceneElements: () => readonly unknown[];
  getAppState: () => Record<string, unknown>;
  getFiles: () => Record<string, unknown>;
};

export function SketchDrawer({
  sketchId,
  open,
  onOpenChange,
}: {
  sketchId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data } = useArtifact("sketches", sketchId);
  const { state, upload } = useArtifactUpload("sketches", sketchId);
  const [scene, setScene] = useState<object | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [api, setApi] = useState<ExcalidrawAPI | null>(null);
  const portalContainer = getOverlayContainer();

  const url = data?.status === "ready" ? data.download?.url : undefined;

  useEffect(() => {
    if (!open) {
      setScene(null);
      setLoaded(false);
      return;
    }
    if (!url) {
      // Freshly created sketch may briefly lack a ready download; treat as blank.
      setScene({ elements: [], appState: {} });
      setLoaded(true);
      return;
    }
    let cancelled = false;
    fetch(url)
      .then((r) => r.json())
      .then((s) => {
        if (!cancelled) {
          setScene(s);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setScene({ elements: [], appState: {} });
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, url]);

  const save = async () => {
    if (!api) return;
    const { serializeAsJSON } = await import("@excalidraw/excalidraw");
    const json = serializeAsJSON(
      api.getSceneElements() as never,
      api.getAppState() as never,
      api.getFiles() as never,
      "local"
    );
    const ok = await upload(new Blob([json], { type: "application/json" }), "application/json");
    if (ok) onOpenChange(false);
  };

  const busy = state.phase === "uploading" || state.phase === "finalizing";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={portalContainer}>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content} onEscapeKeyDown={(e) => e.preventDefault()}>
          <VisuallyHidden.Root>
            <Dialog.Title>Sketch editor</Dialog.Title>
          </VisuallyHidden.Root>
          <div className={styles.toolbar}>
            <span className={styles.title}>Sketch</span>
            {state.phase === "failed" && <span className={styles.error}>Save failed — retry</span>}
            <div className={styles.actions}>
              <Button onClick={() => onOpenChange(false)} data-testid={TID.sketchClose}>
                Close without saving
              </Button>
              <Button
                variant="primary"
                onClick={save}
                disabled={busy || !api}
                data-testid={TID.sketchSave}>
                {busy ? "Saving…" : "Save sketch"}
              </Button>
            </div>
          </div>
          <div className={styles.canvas}>
            {loaded && scene ? (
              <Suspense
                fallback={
                  <div className={styles.loading}>
                    <Spinner size={22} />
                  </div>
                }>
                <Excalidraw
                  initialData={scene as never}
                  excalidrawAPI={(a) => setApi(a as unknown as ExcalidrawAPI)}
                />
              </Suspense>
            ) : (
              <div className={styles.loading}>
                <Spinner size={22} />
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
