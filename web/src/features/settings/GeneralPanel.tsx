import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { keys } from "../../api/keys";
import { listWorlds, renameWorld } from "../../api/endpoints";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { TextInput } from "../../components/TextInput";
import { TID } from "../../testids";
import styles from "./SettingsPanels.module.css";

export function GeneralPanel() {
  const queryClient = useQueryClient();
  const activeWorldId = useWorkspaceStore((s) => s.activeWorldId);
  const { data: worlds } = useQuery({ queryKey: keys.worlds, queryFn: listWorlds });
  const activeWorld = worlds?.items.find((w) => w.id === activeWorldId) ?? null;
  const [name, setName] = useState(activeWorld?.name ?? "");

  useEffect(() => {
    setName(activeWorld?.name ?? "");
  }, [activeWorld?.id, activeWorld?.name]);

  const rename = useMutation({
    mutationFn: (nextName: string) => renameWorld(activeWorldId!, nextName),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.worlds }),
  });

  if (!activeWorldId || !activeWorld) {
    return <p className={styles.hint}>No active world selected.</p>;
  }

  const commitName = () => {
    const nextName = name.trim();
    if (!nextName || nextName === activeWorld.name) {
      setName(activeWorld.name);
      return;
    }
    rename.mutate(nextName);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.rows}>
        <div className={styles.field}>
          <label htmlFor="general-world-name">World name</label>
          <TextInput
            id="general-world-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            data-testid={TID.generalWorldName}
          />
        </div>
      </div>
      <p className={styles.hint}>Create or switch worlds from the header world switcher.</p>
    </div>
  );
}
