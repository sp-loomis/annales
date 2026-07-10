// Inline cross-entry link chip: [TypeIcon] Title. Attrs carry a denormalized
// label/typeSlug from link-time; the live cached entry title wins when
// available so renames self-correct opportunistically.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { keys } from '../../../../api/keys';
import { listEntryTypes } from '../../../../api/endpoints';
import type { EntryDetail } from '../../../../api/types';
import { useWorkspaceStore } from '../../../../stores/workspaceStore';
import { WorldIcon } from '../../../../components/icons/WorldIcon';
import styles from './LinkChip.module.css';

export function LinkChip({
  entryId,
  label,
  typeSlug,
  interactive = true,
}: {
  entryId: string;
  label: string;
  typeSlug: string | null;
  interactive?: boolean;
}) {
  const worldId = useWorkspaceStore((s) => s.activeWorldId);
  const openTab = useWorkspaceStore((s) => s.openTab);
  const queryClient = useQueryClient();

  const cached = queryClient.getQueryData<EntryDetail>(keys.entry(entryId));
  const title = cached?.title ?? label;
  const slug = cached?.type ?? typeSlug;

  const { data: types } = useQuery({
    queryKey: worldId ? keys.entryTypes(worldId) : ['entry-types', 'none'],
    queryFn: () => listEntryTypes(worldId!),
    enabled: worldId !== null,
  });
  const type = types?.items.find((t) => t.slug === slug);

  return (
    <button
      type="button"
      className={styles.chip}
      onClick={interactive ? () => openTab(entryId) : undefined}
      tabIndex={interactive ? 0 : -1}
      data-entry-link={entryId}
    >
      <WorldIcon iconName={type?.iconName} iconWeight={type?.iconWeight} size={12} />
      {title}
    </button>
  );
}
