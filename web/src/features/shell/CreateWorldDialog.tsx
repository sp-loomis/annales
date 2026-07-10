import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent } from '../../components/Dialog';
import { Button } from '../../components/Button';
import { TextInput } from '../../components/TextInput';
import { createWorld } from '../../api/endpoints';
import { keys } from '../../api/keys';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { TID } from '../../testids';
import styles from './CreateWorldDialog.module.css';

export function CreateWorldDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState('');
  const queryClient = useQueryClient();
  const setActiveWorld = useWorkspaceStore((s) => s.setActiveWorld);

  const mutation = useMutation({
    mutationFn: createWorld,
    onSuccess: async (world) => {
      await queryClient.invalidateQueries({ queryKey: keys.worlds });
      setActiveWorld(world.id);
      setName('');
      onOpenChange(false);
    },
  });

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed) mutation.mutate(trimmed);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Create world">
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <TextInput
            autoFocus
            placeholder="World name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid={TID.createWorldName}
          />
          {mutation.isError && <p className={styles.error}>{(mutation.error as Error).message}</p>}
          <div className={styles.actions}>
            <Button
              variant="primary"
              type="submit"
              disabled={!name.trim() || mutation.isPending}
              data-testid={TID.createWorldSubmit}
            >
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog.Root>
  );
}
