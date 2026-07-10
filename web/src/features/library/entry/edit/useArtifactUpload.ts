// Upload lifecycle for file-backed artifacts: PUT bytes to the presigned slot
// (XHR, so progress is observable) then finalize. Uploads are immediate, not
// Save-deferred — progress UX needs live requests. Failed uploads retry via a
// fresh upload-url.

import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { keys } from '../../../../api/keys';
import {
  artifactUploadUrl,
  finalizeArtifact,
  uploadToPresigned,
  type UploadKind,
} from '../../../../api/endpoints';

export type UploadPhase = 'idle' | 'uploading' | 'finalizing' | 'done' | 'failed';

export interface UploadState {
  phase: UploadPhase;
  progress: number;
  error: string | null;
}

const IDLE: UploadState = { phase: 'idle', progress: 0, error: null };

export function useArtifactUpload(kind: UploadKind, artifactId: string) {
  const [state, setState] = useState<UploadState>(IDLE);
  const queryClient = useQueryClient();

  /**
   * Upload bytes to a known presigned URL (fresh create response), or request
   * a new slot first when url is omitted (replace / retry).
   */
  const upload = useCallback(
    async (blob: Blob, contentType: string, presignedUrl?: string) => {
      setState({ phase: 'uploading', progress: 0, error: null });
      try {
        const url = presignedUrl ?? (await artifactUploadUrl(kind, artifactId)).upload.url;
        await uploadToPresigned(url, blob, contentType, (progress) =>
          setState({ phase: 'uploading', progress, error: null })
        );
        setState({ phase: 'finalizing', progress: 1, error: null });
        await finalizeArtifact(kind, artifactId);
        await queryClient.invalidateQueries({ queryKey: keys.artifact(kind, artifactId) });
        setState({ phase: 'done', progress: 1, error: null });
        return true;
      } catch (e) {
        setState({
          phase: 'failed',
          progress: 0,
          error: e instanceof Error ? e.message : String(e),
        });
        return false;
      }
    },
    [kind, artifactId, queryClient]
  );

  return { state, upload };
}
