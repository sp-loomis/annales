// Sketch block in edit mode: static preview, editable caption, and an "Open
// sketch" button that expands into the full-screen Excalidraw drawer.

import { useState } from 'react';
import { PencilSimple } from '@phosphor-icons/react';
import { Button } from '../../../../components/Button';
import { TextInput } from '../../../../components/TextInput';
import { SketchPreview } from '../read/SketchPreview';
import { SketchDrawer } from './SketchDrawer';
import { TID } from '../../../../testids';
import styles from './SketchBlockEdit.module.css';

export function SketchBlockEdit({
  blockKey,
  sketchId,
  label,
  onLabelChange,
  autoOpen,
}: {
  blockKey: string;
  sketchId: string;
  label: string | null;
  onLabelChange: (label: string | null) => void;
  /** Freshly inserted sketches open the drawer immediately. */
  autoOpen?: boolean;
}) {
  const [drawerOpen, setDrawerOpen] = useState(autoOpen ?? false);

  return (
    <div className={styles.block}>
      <SketchPreview sketchId={sketchId} label={null} />
      <div className={styles.controls}>
        <TextInput
          placeholder="Caption"
          value={label ?? ''}
          onChange={(e) => onLabelChange(e.target.value === '' ? null : e.target.value)}
        />
        <Button onClick={() => setDrawerOpen(true)} data-testid={TID.sketchOpen(blockKey)}>
          <PencilSimple size={13} />
          Open sketch
        </Button>
      </div>
      <SketchDrawer sketchId={sketchId} open={drawerOpen} onOpenChange={setDrawerOpen} />
    </div>
  );
}
