// Artifact-detail query with presigned-URL-aware staleness: the download URL
// expires server-side, so staleTime tracks expiresAt (minus a safety margin)
// and consumers can invalidate on load errors to self-heal.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { keys } from '../../../../api/keys';
import { getArtifact, type UploadKind } from '../../../../api/endpoints';

export function useArtifact(kind: UploadKind, id: string) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: keys.artifact(kind, id),
    queryFn: () => getArtifact(kind, id),
    staleTime: (q) => {
      const expiresAt = q.state.data?.download?.expiresAt;
      if (!expiresAt) return 30_000;
      return Math.max(0, new Date(expiresAt).getTime() - Date.now() - 60_000);
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.artifact(kind, id) });

  return { ...query, refresh };
}
