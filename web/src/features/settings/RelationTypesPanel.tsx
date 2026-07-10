// Per-world relation type registry: icon + name ⇄ inverseName rows.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash } from "@phosphor-icons/react";
import { keys } from "../../api/keys";
import {
  createRelationType,
  deleteRelationType,
  listRelationTypes,
  patchRelationType,
} from "../../api/endpoints";
import { ApiError } from "../../api/client";
import type { RelationType } from "../../api/types";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { Button } from "../../components/Button";
import { TextInput } from "../../components/TextInput";
import { IconButton } from "../../components/IconButton";
import { IconPicker } from "./IconPicker";
import { TID } from "../../testids";
import { useScaledPx } from "../../theme/ui-scale";
import styles from "./SettingsPanels.module.css";

function TypeRow({ type, onError }: { type: RelationType; onError: (msg: string | null) => void }) {
  const trashIconSize = useScaledPx(14);
  const queryClient = useQueryClient();
  const [name, setName] = useState(type.name);
  const [inverse, setInverse] = useState(type.inverseName ?? "");
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: keys.relationTypes(type.worldId) });

  const patch = useMutation({
    mutationFn: (body: Parameters<typeof patchRelationType>[1]) => patchRelationType(type.id, body),
    onSuccess: () => {
      onError(null);
      invalidate();
    },
    onError: (e) => onError(e instanceof ApiError ? e.message : "Update failed"),
  });

  const remove = useMutation({
    mutationFn: () => deleteRelationType(type.id),
    onSuccess: () => {
      onError(null);
      invalidate();
    },
    onError: (e) =>
      onError(
        e instanceof ApiError && e.code === "IN_USE"
          ? `"${type.name}" is in use by existing relations and cannot be deleted.`
          : "Delete failed"
      ),
  });

  return (
    <div className={styles.row} data-testid={TID.relationTypeRow(type.id)}>
      <IconPicker
        iconName={type.iconName}
        iconWeight={type.iconWeight}
        onChange={(p) => patch.mutate(p)}
      />
      <TextInput
        value={name}
        placeholder="name"
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          if (name.trim() && name !== type.name) patch.mutate({ name: name.trim() });
        }}
      />
      <TextInput
        value={inverse}
        placeholder="inverse (optional)"
        onChange={(e) => setInverse(e.target.value)}
        onBlur={() => {
          const v = inverse.trim() === "" ? null : inverse.trim();
          if (v !== type.inverseName) patch.mutate({ inverseName: v });
        }}
      />
      <IconButton label="Delete relation type" onClick={() => remove.mutate()}>
        <Trash size={trashIconSize} />
      </IconButton>
    </div>
  );
}

export function RelationTypesPanel() {
  const worldId = useWorkspaceStore((s) => s.activeWorldId);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newInverse, setNewInverse] = useState("");

  const { data: types } = useQuery({
    queryKey: worldId ? keys.relationTypes(worldId) : ["relation-types", "none"],
    queryFn: () => listRelationTypes(worldId!),
    enabled: worldId !== null,
  });

  const create = useMutation({
    mutationFn: () =>
      createRelationType(worldId!, {
        name: newName.trim(),
        inverseName: newInverse.trim() === "" ? null : newInverse.trim(),
      }),
    onSuccess: () => {
      setNewName("");
      setNewInverse("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: keys.relationTypes(worldId!) });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Create failed"),
  });

  if (!worldId) return null;

  return (
    <div className={styles.panel}>
      <p className={styles.hint}>
        Directed edges between entries. The inverse name labels the edge when read from the target
        side (e.g. “rules” ⇄ “is ruled by”).
      </p>
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
        }}>
        <TextInput
          placeholder="New relation name…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <TextInput
          placeholder="Inverse (optional)"
          value={newInverse}
          onChange={(e) => setNewInverse(e.target.value)}
        />
        <Button type="submit" disabled={!newName.trim()} data-testid={TID.relationTypeAdd}>
          Add
        </Button>
      </form>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
