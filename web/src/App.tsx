import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GlobeIcon } from '@phosphor-icons/react';
import { keys } from './api/keys';
import { listWorlds } from './api/endpoints';
import { useWorkspaceStore } from './stores/workspaceStore';
import { ThemeProvider } from './theme/ThemeProvider';
import { AppLayout } from './features/shell/AppLayout';
import { CreateWorldDialog } from './features/shell/CreateWorldDialog';
import { EmptyState } from './components/EmptyState';
import { Button } from './components/Button';
import { Spinner } from './components/Spinner';
import { LibrarySidebar } from './features/library/sidebar/LibrarySidebar';
import { LibraryBody } from './features/library/LibraryBody';
import { useWorkspacePersistence } from './features/library/tabs/useWorkspacePersistence';
import { useAnyDirty } from './stores/draftStore';
import { SettingsDialog } from './features/settings/SettingsDialog';
import styles from './App.module.css';

const LAST_WORLD_KEY = 'sheaf:lastWorldId';

export default function App() {
  const activeWorldId = useWorkspaceStore((s) => s.activeWorldId);
  const setActiveWorld = useWorkspaceStore((s) => s.setActiveWorld);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: worlds, isLoading } = useQuery({ queryKey: keys.worlds, queryFn: listWorlds });

  useWorkspacePersistence();

  // beforeunload guard: registered only while unsaved changes exist, removed
  // immediately on save/cancel (spec requires reactive registration).
  const anyDirty = useAnyDirty();
  useEffect(() => {
    if (!anyDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [anyDirty]);

  // Boot: restore the last active world, or fall back to the first one.
  useEffect(() => {
    if (!worlds) return;
    if (activeWorldId && worlds.items.some((w) => w.id === activeWorldId)) return;
    const stored = localStorage.getItem(LAST_WORLD_KEY);
    const pick = worlds.items.find((w) => w.id === stored) ?? worlds.items[0];
    setActiveWorld(pick?.id ?? null);
  }, [worlds, activeWorldId, setActiveWorld]);

  useEffect(() => {
    if (activeWorldId) localStorage.setItem(LAST_WORLD_KEY, activeWorldId);
  }, [activeWorldId]);

  if (isLoading) {
    return (
      <div className={styles.center}>
        <Spinner size={24} />
      </div>
    );
  }

  if (worlds && worlds.items.length === 0) {
    return (
      <div className={styles.center}>
        <EmptyState
          icon={<GlobeIcon size={40} />}
          message="Every saga starts somewhere. Create your first world to begin."
          action={
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              Create your first world
            </Button>
          }
        />
        <CreateWorldDialog open={createOpen} onOpenChange={setCreateOpen} />
      </div>
    );
  }

  return (
    <ThemeProvider worldId={activeWorldId}>
      <AppLayout
        sidebar={<LibrarySidebar />}
        body={<LibraryBody />}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </ThemeProvider>
  );
}
