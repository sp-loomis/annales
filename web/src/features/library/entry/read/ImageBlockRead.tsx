import { ImageBroken, Image as ImageIcon } from '@phosphor-icons/react';
import { Spinner } from '../../../../components/Spinner';
import { useArtifact } from './useArtifact';
import styles from './ImageBlockRead.module.css';

export function ImageBlockRead({ imageId, label }: { imageId: string; label: string | null }) {
  const { data, isLoading, refresh } = useArtifact('images', imageId);

  if (isLoading) {
    return (
      <figure className={styles.figure}>
        <div className={styles.placeholder}>
          <Spinner />
        </div>
      </figure>
    );
  }

  if (!data || data.status !== 'ready' || !data.download) {
    const failed = data?.status === 'failed';
    return (
      <figure className={styles.figure}>
        <div className={styles.placeholder}>
          {failed ? <ImageBroken size={24} /> : <ImageIcon size={24} />}
          <span>{failed ? 'Upload failed' : 'Image not ready'}</span>
        </div>
        {label && <figcaption className={styles.caption}>{label}</figcaption>}
      </figure>
    );
  }

  return (
    <figure className={styles.figure}>
      <img
        src={data.download.url}
        alt={label ?? ''}
        className={styles.image}
        onError={() => refresh()}
      />
      {label && <figcaption className={styles.caption}>{label}</figcaption>}
    </figure>
  );
}
