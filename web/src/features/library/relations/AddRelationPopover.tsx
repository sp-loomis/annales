// Add-relation control in the edit-mode relation block. Relation mutations
// are immediate (not Save-deferred): pick a relation type, a direction
// framing, and a target entry (typeahead over the world's entries).

import { useMemo, useState } from 'react';
import { Popover } from 'radix-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from '@phosphor-icons/react';
import { keys } from '../../../api/keys';
import { createRelation, listRelationTypes } from '../../../api/endpoints';
import { ApiError } from '../../../api/client';
import type { EntryDetail } from '../../../api/types';
import { useWorkspaceStore } from '../../../stores/workspaceStore';
import { useEntriesQuery } from '../sidebar/useSidebarData';
import { Button } from '../../../components/Button';
import { TextInput } from '../../../components/TextInput';
import { WorldIcon } from '../../../components/icons/WorldIcon';
import { TID } from '../../../testids';
import styles from './AddRelationPopover.module.css';

export function AddRelationPopover({ entry }: { entry: EntryDetail }) {
  const worldId = useWorkspaceStore((s) => s.activeWorldId);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [typeId, setTypeId] = useState('');
  const [outward, setOutward] = useState(true);
  const [targetQuery, setTargetQuery] = useState('');
  const [targetId, setTargetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: relationTypes } = useQuery({
    queryKey: worldId ? keys.relationTypes(worldId) : ['relation-types', 'none'],
    queryFn: () => listRelationTypes(worldId!),
    enabled: worldId !== null && open,
  });
  const { data: entries } = useEntriesQuery(open ? worldId : null);

  const effectiveTypeId = typeId || relationTypes?.items[0]?.id || '';
  const selectedType = relationTypes?.items.find((t) => t.id === effectiveTypeId);

  const candidates = useMemo(() => {
    const q = targetQuery.trim().toLowerCase();
    return (entries ?? [])
      .filter((e) => e.id !== entry.id)
      .filter((e) => !q || e.title.toLowerCase().includes(q))
      .slice(0, 8);
  }, [entries, targetQuery, entry.id]);

  const target = (entries ?? []).find((e) => e.id === targetId);

  const mutation = useMutation({
    mutationFn: () =>
      createRelation({
        fromId: outward ? entry.id : targetId!,
        toId: outward ? targetId! : entry.id,
        typeId: effectiveTypeId,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.entry(entry.id) });
      if (targetId) await queryClient.invalidateQueries({ queryKey: keys.entry(targetId) });
      setTargetId(null);
      setTargetQuery('');
      setError(null);
      setOpen(false);
    },
    onError: (e) => {
      setError(e instanceof ApiError ? e.message : 'Could not create relation');
    },
  });

  const noTypes = open && relationTypes && relationTypes.items.length === 0;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button variant="ghost" className={styles.trigger} data-testid={TID.relationAdd}>
          <Plus size={12} />
          Add relation
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className={styles.popover} sideOffset={6} align="end">
          {noTypes ? (
            <p className={styles.hint}>
              No relation types defined yet. Add one in World Settings → Relation Types.
            </p>
          ) : (
            <div className={styles.form}>
              <select
                className={styles.select}
                value={effectiveTypeId}
                onChange={(e) => setTypeId(e.target.value)}
                data-testid={TID.relationTypeSelect}
              >
                {(relationTypes?.items ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.inverseName ? ` / ${t.inverseName}` : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={styles.direction}
                onClick={() => setOutward((v) => !v)}
                data-testid={TID.relationDirectionToggle}
              >
                {outward
                  ? `${entry.title} — ${selectedType?.name ?? '…'} → target`
                  : `target — ${selectedType?.name ?? '…'} → ${entry.title}`}
              </button>
              {target ? (
                <div className={styles.selectedTarget}>
                  <span>{target.title}</span>
                  <Button variant="ghost" onClick={() => setTargetId(null)}>
                    Change
                  </Button>
                </div>
              ) : (
                <>
                  <TextInput
                    placeholder="Find target entry…"
                    value={targetQuery}
                    onChange={(e) => setTargetQuery(e.target.value)}
                    data-testid={TID.relationTargetInput}
                  />
                  <div className={styles.candidates}>
                    {candidates.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className={styles.candidate}
                        onClick={() => setTargetId(c.id)}
                      >
                        <TypeIconForSlug slug={c.type} />
                        {c.title}
                      </button>
                    ))}
                    {candidates.length === 0 && <p className={styles.hint}>No matches.</p>}
                  </div>
                </>
              )}
              {error && <p className={styles.error}>{error}</p>}
              <Button
                variant="primary"
                disabled={!targetId || !effectiveTypeId || mutation.isPending}
                onClick={() => mutation.mutate()}
                data-testid={TID.relationSubmit}
              >
                Add
              </Button>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function TypeIconForSlug({ slug }: { slug: string }) {
  const worldId = useWorkspaceStore((s) => s.activeWorldId);
  const { data: types } = useQuery({
    queryKey: worldId ? keys.entryTypes(worldId) : ['entry-types', 'none'],
    queryFn: async () => {
      const { listEntryTypes } = await import('../../../api/endpoints');
      return listEntryTypes(worldId!);
    },
    enabled: worldId !== null,
  });
  const type = types?.items.find((t) => t.slug === slug);
  return <WorldIcon iconName={type?.iconName} iconWeight={type?.iconWeight} size={12} />;
}
