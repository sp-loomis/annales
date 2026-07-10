// World Settings: sectioned modal (General / Entry Types / Relation Types /
// World Theme). Timelines & Calendars and Globes & CRS sections join this nav
// when their add-ons are built.

import { useState } from "react";
import { Dialog } from "radix-ui";
import { X } from "@phosphor-icons/react";
import { IconButton } from "../../components/IconButton";
import { GeneralPanel } from "./GeneralPanel";
import { EntryTypesPanel } from "./EntryTypesPanel";
import { RelationTypesPanel } from "./RelationTypesPanel";
import { ThemePanel } from "./ThemePanel";
import { TID } from "../../testids";
import { getOverlayContainer } from "../../lib/overlay";
import { useScaledPx } from "../../theme/ui-scale";
import dialogStyles from "../../components/Dialog.module.css";
import styles from "./SettingsDialog.module.css";

const SECTIONS = [
  { key: "general", label: "General", Panel: GeneralPanel },
  { key: "entry-types", label: "Entry Types", Panel: EntryTypesPanel },
  { key: "relation-types", label: "Relation Types", Panel: RelationTypesPanel },
  { key: "theme", label: "World Theme", Panel: ThemePanel },
] as const;

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [section, setSection] = useState<(typeof SECTIONS)[number]["key"]>("general");
  const closeIconSize = useScaledPx(16);
  const Active = SECTIONS.find((s) => s.key === section)?.Panel ?? GeneralPanel;
  const portalContainer = getOverlayContainer();

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={portalContainer}>
        <Dialog.Overlay className={dialogStyles.overlay} />
        <Dialog.Content className={styles.content}>
          <div className={styles.nav}>
            <Dialog.Title className={styles.title}>World Settings</Dialog.Title>
            {SECTIONS.map((s) => (
              <button
                key={s.key}
                type="button"
                className={[styles.navItem, s.key === section ? styles.navActive : ""].join(" ")}
                onClick={() => setSection(s.key)}
                data-testid={TID.settingsNav(s.key)}>
                {s.label}
              </button>
            ))}
          </div>
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>
                {SECTIONS.find((s) => s.key === section)?.label}
              </h2>
              <Dialog.Close asChild>
                <IconButton label="Close settings" data-testid={TID.settingsClose}>
                  <X size={closeIconSize} />
                </IconButton>
              </Dialog.Close>
            </div>
            <div className={styles.panelBody}>
              <Active />
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
