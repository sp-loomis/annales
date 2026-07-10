// Header world selector: shows the active world's name in its own font/accent;
// clicking opens a popover of all worlds as chips (accent dot + entry-type
// icon cluster as a visual fingerprint) plus a "New world" row. Per-world
// theme/type queries run only while the popover is open.

import { useState } from "react";
import { Popover } from "radix-ui";
import { useQuery } from "@tanstack/react-query";
import { CaretDown, Plus } from "@phosphor-icons/react";
import { keys } from "../../api/keys";
import { getTheme, listEntryTypes, listWorlds } from "../../api/endpoints";
import type { World } from "../../api/types";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { WorldIcon } from "../../components/icons/WorldIcon";
import { CreateWorldDialog } from "./CreateWorldDialog";
import { TID } from "../../testids";
import { getOverlayContainer } from "../../lib/overlay";
import styles from "./WorldSwitcher.module.css";

function WorldRow({
  world,
  active,
  onSelect,
}: {
  world: World;
  active: boolean;
  onSelect: () => void;
}) {
  const { data: theme } = useQuery({
    queryKey: keys.theme(world.id),
    queryFn: () => getTheme(world.id),
  });
  const { data: types } = useQuery({
    queryKey: keys.entryTypes(world.id),
    queryFn: () => listEntryTypes(world.id),
  });

  return (
    <button
      type="button"
      className={[styles.worldRow, active ? styles.activeRow : ""].filter(Boolean).join(" ")}
      onClick={onSelect}
      data-testid={TID.worldSwitcherItem(world.id)}>
      <span
        className={styles.accentDot}
        style={{ background: theme?.accentColor ?? "var(--accent)" }}
      />
      <span className={styles.worldName}>{world.name}</span>
      <span className={styles.iconCluster}>
        {(types?.items ?? []).slice(0, 5).map((t) => (
          <WorldIcon key={t.id} iconName={t.iconName} iconWeight={t.iconWeight} size={13} />
        ))}
      </span>
    </button>
  );
}

export function WorldSwitcher() {
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const activeWorldId = useWorkspaceStore((s) => s.activeWorldId);
  const setActiveWorld = useWorkspaceStore((s) => s.setActiveWorld);
  const portalContainer = getOverlayContainer();
  const { data: worlds } = useQuery({ queryKey: keys.worlds, queryFn: listWorlds });

  const active = worlds?.items.find((w) => w.id === activeWorldId);

  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button type="button" className={styles.trigger} data-testid={TID.worldSwitcherTrigger}>
            <span className={styles.currentName}>{active?.name ?? "Select world"}</span>
            <CaretDown size={12} />
          </button>
        </Popover.Trigger>
        <Popover.Portal container={portalContainer}>
          <Popover.Content className={styles.popover} sideOffset={6} align="start">
            <div className={styles.worldList}>
              {(worlds?.items ?? []).map((w) => (
                <WorldRow
                  key={w.id}
                  world={w}
                  active={w.id === activeWorldId}
                  onSelect={() => {
                    setActiveWorld(w.id);
                    setOpen(false);
                  }}
                />
              ))}
            </div>
            <button
              type="button"
              className={styles.newWorld}
              onClick={() => {
                setOpen(false);
                setCreateOpen(true);
              }}
              data-testid={TID.worldSwitcherNew}>
              <Plus size={14} />
              New world
            </button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <CreateWorldDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
