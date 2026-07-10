// Image block in edit mode: current image (or upload state), editable caption,
// and a replace flow (fresh presigned slot → PUT → finalize). A pending file
// from the insert picker starts uploading on mount.

import { useEffect, useRef, useState } from 'react';
import { ArrowsClockwise, Image as ImageIcon, WarningCircle } from '@phosphor-icons/react';
import { Button } from '../../../../components/Button';
import { TextInput } from '../../../../components/TextInput';
import { useArtifact } from '../read/useArtifact';
import { useArtifactUpload } from './useArtifactUpload';
import { TID } from '../../../../testids';
import styles from './ImageBlockEdit.module.css';

export interface PendingUpload {
  file: File;
  presignedUrl: string;
}

export function ImageBlockEdit({
  blockKey,
  imageId,
  label,
  pendingUpload,
  onLabelChange,
}: {
  blockKey: string;
  imageId: string;
  label: string | null;
  /** Set when the block was just inserted — bytes not yet uploaded. */
  pendingUpload?: PendingUpload;
  onLabelChange: (label: string | null) => void;
}) {
  const { data } = useArtifact('images', imageId);
  const { state, upload } = useArtifactUpload('images', imageId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [lastFile, setLastFile] = useState<File | null>(pendingUpload?.file ?? null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (pendingUpload && !startedRef.current) {
      startedRef.current = true;
      void upload(pendingUpload.file, pendingUpload.file.type, pendingUpload.presignedUrl);
    }
  }, [pendingUpload, upload]);

  const pickReplacement = (file: File) => {
    setLastFile(file);
    void upload(file, file.type);
  };

  const busy = state.phase === 'uploading' || state.phase === 'finalizing';
  const ready = data?.status === 'ready' && data.download && !busy;

  return (
    <div className={styles.block}>
      <div className={styles.imageArea}>
        {ready ? (
          <img src={data.download!.url} alt={label ?? ''} className={styles.image} />
        ) : (
          <div className={styles.placeholder}>
            {busy ? (
              <>
                <div className={styles.progressTrack}>
                  <div
                    className={styles.progressFill}
                    style={{ width: `${Math.round(state.progress * 100)}%` }}
                  />
                </div>
                <span>{state.phase === 'finalizing' ? 'Processing…' : 'Uploading…'}</span>
              </>
            ) : state.phase === 'failed' || data?.status === 'failed' ? (
              <>
                <WarningCircle size={22} />
                <span>Upload failed</span>
                {lastFile && (
                  <Button onClick={() => pickReplacement(lastFile)}>
                    <ArrowsClockwise size={13} />
                    Retry
                  </Button>
                )}
              </>
            ) : (
              <>
                <ImageIcon size={22} />
                <span>Image pending</span>
              </>
            )}
          </div>
        )}
      </div>
      <div className={styles.controls}>
        <TextInput
          placeholder="Caption"
          value={label ?? ''}
          onChange={(e) => onLabelChange(e.target.value === '' ? null : e.target.value)}
        />
        <Button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          data-testid={TID.imageReplace(blockKey)}
        >
          Replace
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) pickReplacement(file);
          }}
        />
      </div>
    </div>
  );
}
