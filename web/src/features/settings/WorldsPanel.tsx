import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash } from '@phosphor-icons/react';
import { keys } from '../../api/keys';
import { deleteWorld, listWorlds, renameWorld } from '../../api/endpoints';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { Button } from '../../components/Button';
import { TextInput } from '../../components/TextInput';
import { IconButton } from '../../components/IconButton';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { CreateWorldDialog } from '../shell/CreateWorldDialog';
import { TID } from '../../testids';
import styles from './SettingsPanels.module.css';

export function WorldsPanel() {
  const queryClient = useQueryClient();
  const activeWorldId = useWorkspaceStore((s) => s.activeWorldId);
  const setActiveWorld = useWorkspaceStore((s) => s.setActiveWorld);
  const { data: worlds } = useQuery({ queryKey: keys.worlds, queryFn: listWorlds });
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameWorld(id, name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.worlds }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteWorld(id),
    onSuccess: async (_data, id) => {
      await queryClient.invalidateQueries({ queryKey: keys.worlds });
      if (activeWorldId === id) {
        const remaining = queryClient
          .getQueryData<{ items: { id: string }[] }>(keys.worlds)
          ?.items.filter((w) => w.id !== id);
        setActiveWorld(remaining?.[0]?.id ?? null);
      }
    },
  });

  return (
    <div className={styles.panel}>
      <div className={styles.rows}>
        {(worlds?.items ?? []).map((w) => (
          <div key={w.id} className={styles.row} data-testid={TID.worldRow(w.id)}>
            <TextInput
              value={names[w.id] ?? w.name}
              onChange={(e) => setNames((n) => ({ ...n, [w.id]: e.target.value }))}
              onBlur={() => {
                const name = (names[w.id] ?? w.name).trim();
                if (name && name !== w.name) rename.mutate({ id: w.id, name });
              }}
              data-testid={TID.worldRename(w.id)}
            />
            <IconButton
              label="Delete world"
              onClick={() => setPendingDelete({ id: w.id, name: w.name })}
              data-testid={TID.worldDelete(w.id)}
            >
              <Trash size={14} />
            </IconButton>
          </div>
        ))}
      </div>
      <Button onClick={() => setCreateOpen(true)}>New world</Button>
      <CreateWorldDialog open={createOpen} onOpenChange={setCreateOpen} />
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={`Delete "${pendingDelete?.name}"?`}
        description="The world and everything in it — all entries, sections, images, sketches, relations, types and theme — will be permanently deleted."
        confirmLabel="Delete world"
        danger
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete.id);
          setPendingDelete(null);
        }}
      />
    </div>
  );
}
