import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent } from '../../../components/Dialog';
import { Button } from '../../../components/Button';
import { TextInput } from '../../../components/TextInput';
import { keys } from '../../../api/keys';
import { createEntry, listEntryTypes } from '../../../api/endpoints';
import { TID } from '../../../testids';
import styles from './NewEntryDialog.module.css';

export function NewEntryDialog({
  worldId,
  open,
  onOpenChange,
  onCreated,
}: {
  worldId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (entryId: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [typeSlug, setTypeSlug] = useState('');
  const queryClient = useQueryClient();

  const { data: types } = useQuery({
    queryKey: keys.entryTypes(worldId),
    queryFn: () => listEntryTypes(worldId),
    enabled: open,
  });

  const effectiveType = typeSlug || types?.items[0]?.slug || '';

  const mutation = useMutation({
    mutationFn: () => createEntry(worldId, { type: effectiveType, title: title.trim() }),
    onSuccess: async (entry) => {
      await queryClient.invalidateQueries({ queryKey: keys.entries(worldId) });
      setTitle('');
      onOpenChange(false);
      onCreated(entry.id);
    },
  });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <DialogContent title="New entry">
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim() && effectiveType) mutation.mutate();
          }}
        >
          <TextInput
            autoFocus
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            data-testid={TID.newEntryTitle}
          />
          <select
            className={styles.select}
            value={effectiveType}
            onChange={(e) => setTypeSlug(e.target.value)}
            data-testid={TID.newEntryType}
          >
            {(types?.items ?? []).map((t) => (
              <option key={t.id} value={t.slug}>
                {t.name}
              </option>
            ))}
          </select>
          {mutation.isError && <p className={styles.error}>{(mutation.error as Error).message}</p>}
          <div className={styles.actions}>
            <Button
              variant="primary"
              type="submit"
              disabled={!title.trim() || !effectiveType || mutation.isPending}
              data-testid={TID.newEntrySubmit}
            >
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog.Root>
  );
}
