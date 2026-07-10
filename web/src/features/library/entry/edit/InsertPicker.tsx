// The + affordance between/below blocks. Opens a block-type picker: Section,
// Image (file select), Sketch. Geometry joins this picker when that add-on is
// built.

import { useRef, useState } from 'react';
import { Popover } from 'radix-ui';
import { Image, PencilSimple, Plus, TextAlignLeft } from '@phosphor-icons/react';
import { TID } from '../../../../testids';
import styles from './InsertPicker.module.css';

export function InsertPicker({
  afterKey,
  onSection,
  onImage,
  onSketch,
}: {
  afterKey: string;
  onSection: () => void;
  onImage: (file: File) => void;
  onSketch: () => void;
}) {
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className={styles.row}>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className={styles.plus}
            aria-label="Add item"
            data-testid={TID.insertBlock(afterKey)}
          >
            <Plus size={13} />
            <span className={styles.label}>Add Item</span>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className={styles.menu} sideOffset={4} align="center">
            <button
              type="button"
              className={styles.item}
              data-testid={TID.insertPickerSection}
              onClick={() => {
                setOpen(false);
                onSection();
              }}
            >
              <TextAlignLeft size={14} />
              Section
            </button>
            <button
              type="button"
              className={styles.item}
              data-testid={TID.insertPickerImage}
              onClick={() => fileRef.current?.click()}
            >
              <Image size={14} />
              Image
            </button>
            <button
              type="button"
              className={styles.item}
              data-testid={TID.insertPickerSketch}
              onClick={() => {
                setOpen(false);
                onSketch();
              }}
            >
              <PencilSimple size={14} />
              Sketch
            </button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) {
            setOpen(false);
            onImage(file);
          }
        }}
      />
    </div>
  );
}
