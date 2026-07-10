import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { keys } from "../../../api/keys";
import { listEntryTypes } from "../../../api/endpoints";
import type { Density } from "../../../api/types";
import { Chip } from "../../../components/Chip";
import { WorldIcon } from "../../../components/icons/WorldIcon";
import { TID } from "../../../testids";
import { useScaledPx } from "../../../theme/ui-scale";
import type { SidebarItem } from "./useSidebarData";
import styles from "./ResultCard.module.css";

// ts_headline emits plain text with <b>…</b> highlight tags. Escape everything
// else, then re-enable only <b>, before handing to dangerouslySetInnerHTML.
function sanitizeSnippet(snippet: string): string {
  const escaped = snippet.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return escaped.replaceAll("&lt;b&gt;", "<b>").replaceAll("&lt;/b&gt;", "</b>");
}

export function ResultCard({
  item,
  density,
  showSnippets,
  worldId,
  onOpen,
}: {
  item: SidebarItem;
  density: Density;
  showSnippets: boolean;
  worldId: string;
  onOpen: (entryId: string) => void;
}) {
  const iconSize = useScaledPx(14);
  const { data: types } = useQuery({
    queryKey: keys.entryTypes(worldId),
    queryFn: () => listEntryTypes(worldId),
  });
  const type = types?.items.find((t) => t.slug === item.type);

  const snippets = useMemo(
    () =>
      showSnippets && density === "detailed"
        ? item.matches.slice(0, 3).map((m) => sanitizeSnippet(m.snippet))
        : [],
    [showSnippets, density, item.matches]
  );

  return (
    <button
      type="button"
      className={styles.card}
      onClick={() => onOpen(item.entryId)}
      data-testid={TID.resultCard(item.entryId)}>
      <div className={styles.titleRow}>
        <WorldIcon iconName={type?.iconName} iconWeight={type?.iconWeight} size={iconSize} />
        <span className={styles.title}>{item.title}</span>
      </div>
      {density !== "compact" && item.tags.length > 0 && (
        <div className={styles.tags}>
          {item.tags.slice(0, 3).map((tag) => (
            <Chip key={tag} asLabel>
              {tag}
            </Chip>
          ))}
        </div>
      )}
      {snippets.map((html, i) => (
        <p key={i} className={styles.snippet} dangerouslySetInnerHTML={{ __html: html }} />
      ))}
    </button>
  );
}
