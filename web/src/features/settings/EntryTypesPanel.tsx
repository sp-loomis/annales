// Per-world entry type registry: icon + name + slug rows. Slug auto-derives
// from the name for new types (editable before create). Delete surfaces the
// API's 409 IN_USE guard.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash } from '@phosphor-icons/react';
import { keys } from '../../api/keys';
import {
  createEntryType,
  deleteEntryType,
  listEntryTypes,
  patchEntryType,
} from '../../api/endpoints';
import { ApiError } from '../../api/client';
import type { EntryType } from '../../api/types';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { Button } from '../../components/Button';
import { TextInput } from '../../components/TextInput';
import { IconButton } from '../../components/IconButton';
import { IconPicker } from './IconPicker';
import { TID } from '../../testids';
import styles from './SettingsPanels.module.css';

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

function TypeRow({ type, onError }: { type: EntryType; onError: (msg: string | null) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(type.name);
  const [slug, setSlug] = useState(type.slug);
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: keys.entryTypes(type.worldId) });

  const patch = useMutation({
    mutationFn: (body: Parameters<typeof patchEntryType>[1]) => patchEntryType(type.id, body),
    onSuccess: () => {
      onError(null);
      invalidate();
    },
    onError: (e) => onError(e instanceof ApiError ? e.message : 'Update failed'),
  });

  const remove = useMutation({
    mutationFn: () => deleteEntryType(type.id),
    onSuccess: () => {
      onError(null);
      invalidate();
    },
    onError: (e) =>
      onError(
        e instanceof ApiError && e.code === 'IN_USE'
          ? `"${type.name}" is in use by existing entries and cannot be deleted.`
          : 'Delete failed'
      ),
  });

  return (
    <div className={styles.row} data-testid={TID.entryTypeRow(type.id)}>
      <IconPicker
        iconName={type.iconName}
        iconWeight={type.iconWeight}
        onChange={(p) => patch.mutate(p)}
      />
      <TextInput
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          if (name.trim() && name !== type.name) patch.mutate({ name: name.trim() });
        }}
      />
      <TextInput
        className={styles.slugInput}
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
        onBlur={() => {
          const s = slugify(slug);
          setSlug(s);
          if (s && s !== type.slug) patch.mutate({ slug: s });
        }}
      />
      <IconButton label="Delete entry type" onClick={() => remove.mutate()}>
        <Trash size={14} />
      </IconButton>
    </div>
  );
}

export function EntryTypesPanel() {
  const worldId = useWorkspaceStore((s) => s.activeWorldId);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  const { data: types } = useQuery({
    queryKey: worldId ? keys.entryTypes(worldId) : ['entry-types', 'none'],
    queryFn: () => listEntryTypes(worldId!),
    enabled: worldId !== null,
  });

  const create = useMutation({
    mutationFn: () =>
      createEntryType(worldId!, { name: newName.trim(), slug: slugify(newName) }),
    onSuccess: () => {
      setNewName('');
      setError(null);
      queryClient.invalidateQueries({ queryKey: keys.entryTypes(worldId!) });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Create failed'),
  });

  if (!worldId) return null;

  return (
    <div className={styles.panel}>
      <div className={styles.rows}>
        {(types?.items ?? []).map((t) => (
          <TypeRow key={t.id} type={t} onError={setError} />
        ))}
      </div>
      <form
        className={styles.row}
        onSubmit={(e) => {
          e.preventDefault();
          if (newName.trim()) create.mutate();
        }}
      >
        <TextInput
          placeholder="New type name…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <Button type="submit" disabled={!newName.trim()} data-testid={TID.entryTypeAdd}>
          Add
        </Button>
      </form>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
