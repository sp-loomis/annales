// Static preview of an Excalidraw scene: fetch the scene JSON from the
// presigned download URL, render to SVG via a dynamically imported Excalidraw
// (kept out of the main bundle), and inline the result at reduced scale.

import { useEffect, useRef, useState } from 'react';
import { PencilSimple } from '@phosphor-icons/react';
import { Spinner } from '../../../../components/Spinner';
import { useArtifact } from './useArtifact';
import styles from './SketchPreview.module.css';

export function SketchPreview({ sketchId, label }: { sketchId: string; label: string | null }) {
  const { data } = useArtifact('sketches', sketchId);
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const url = data?.status === 'ready' ? data.download?.url : undefined;

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    (async () => {
      try {
        const [{ exportToSvg }, sceneRes] = await Promise.all([
          import('@excalidraw/excalidraw'),
          fetch(url),
        ]);
        const scene = await sceneRes.json();
        if (cancelled) return;
        if (!scene.elements?.length) {
          setState('empty');
          return;
        }
        const svg = await exportToSvg({
          elements: scene.elements,
          appState: { ...scene.appState, exportBackground: false },
          files: scene.files ?? null,
        });
        if (cancelled) return;
        svg.removeAttribute('width');
        svg.removeAttribute('height');
        svg.style.maxWidth = '100%';
        svg.style.maxHeight = '320px';
        containerRef.current?.replaceChildren(svg);
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <figure className={styles.figure}>
      <div className={styles.canvas}>
        <div ref={containerRef} className={styles.svgHost} />
        {state !== 'ready' && (
          <div className={styles.placeholder}>
            {state === 'loading' && url ? (
              <Spinner />
            ) : (
              <>
                <PencilSimple size={24} />
                <span>
                  {state === 'error'
                    ? 'Preview unavailable'
                    : state === 'empty'
                      ? 'Empty sketch'
                      : 'Sketch not ready'}
                </span>
              </>
            )}
          </div>
        )}
      </div>
      {label && <figcaption className={styles.caption}>{label}</figcaption>}
    </figure>
  );
}
