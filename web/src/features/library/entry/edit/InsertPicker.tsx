// The + affordance between/below blocks. Opens a block-type picker: Section,
// Image (file select), Sketch. Geometry joins this picker when that add-on is
// built.

import { useRef, useState } from "react";
import { Popover } from "radix-ui";
import { Image, PencilSimple, Plus, TextAlignLeft } from "@phosphor-icons/react";
import { getOverlayContainer } from "../../../../lib/overlay";
import { TID } from "../../../../testids";
import { useScaledPx } from "../../../../theme/ui-scale";
import styles from "./InsertPicker.module.css";

export function InsertPicker({
  afterKey,
  onSection,
  onImage,
  onSketch,
  allowArtifacts = true,
}: {
  afterKey: string;
  onSection: () => void;
  onImage: (file: File) => void;
  onSketch: () => void;
  allowArtifacts?: boolean;
}) {
  const plusIconSize = useScaledPx(13);
  const menuIconSize = useScaledPx(14);
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const portalContainer = getOverlayContainer();

  return (
    <div className={styles.row}>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className={styles.plus}
            aria-label="Add item"
            data-testid={TID.insertBlock(afterKey)}>
            <Plus size={plusIconSize} />
            <span className={styles.label}>Add Item</span>
          </button>
        </Popover.Trigger>
        <Popover.Portal container={portalContainer}>
          <Popover.Content className={styles.menu} sideOffset={4} align="center">
            <button
              type="button"
              className={styles.item}
              data-testid={TID.insertPickerSection}
              onClick={() => {
                setOpen(false);
                onSection();
              }}>
              <TextAlignLeft size={menuIconSize} />
              Section
            </button>
            <button
              type="button"
              className={styles.item}
              data-testid={TID.insertPickerImage}
              disabled={!allowArtifacts}
              onClick={() => fileRef.current?.click()}>
              <Image size={menuIconSize} />
              Image
            </button>
            <button
              type="button"
              className={styles.item}
              data-testid={TID.insertPickerSketch}
              disabled={!allowArtifacts}
              onClick={() => {
                setOpen(false);
                onSketch();
              }}>
              <PencilSimple size={menuIconSize} />
              Sketch
            </button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) {
            setOpen(false);
            onImage(file);
          }
        }}
      />
    </div>
  );
}
