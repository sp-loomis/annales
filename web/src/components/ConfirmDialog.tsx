// Controlled confirm dialog (Radix AlertDialog) for destructive/discarding
// actions: tab close with unsaved changes, world delete, type delete.

import { AlertDialog } from "radix-ui";
import type { ReactNode } from "react";
import { Button } from "./Button";
import { getOverlayContainer } from "../lib/overlay";
import dialogStyles from "./Dialog.module.css";
import styles from "./ConfirmDialog.module.css";

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  danger,
  onConfirm,
  confirmTestId,
  cancelTestId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  confirmTestId?: string;
  cancelTestId?: string;
}) {
  const portalContainer = getOverlayContainer();

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal container={portalContainer}>
        <AlertDialog.Overlay className={dialogStyles.overlay} />
        <AlertDialog.Content className={dialogStyles.content}>
          <AlertDialog.Title className={dialogStyles.title}>{title}</AlertDialog.Title>
          <AlertDialog.Description className={styles.description}>
            {description}
          </AlertDialog.Description>
          <div className={styles.actions}>
            <AlertDialog.Cancel asChild>
              <Button data-testid={cancelTestId}>{cancelLabel}</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button
                variant={danger ? "danger" : "primary"}
                onClick={onConfirm}
                data-testid={confirmTestId}>
                {confirmLabel}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
