// Applies the active world's WorldTheme to the document: font, accent, surface
// base and dark mode. Everything else derives in tokens.css. Applied on the
// root element so portalled Radix content (popovers, dialogs) inherits too.

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { keys } from "../api/keys";
import { getTheme } from "../api/endpoints";
import { fontByKey } from "./fonts";

export function useWorldTheme(worldId: string | null) {
  return useQuery({
    queryKey: worldId ? keys.theme(worldId) : ["theme", "none"],
    queryFn: () => getTheme(worldId!),
    enabled: worldId !== null,
  });
}

export function ThemeProvider({
  worldId,
  children,
}: {
  worldId: string | null;
  children: React.ReactNode;
}) {
  const { data: theme } = useWorldTheme(worldId);

  useEffect(() => {
    const root = document.documentElement;
    const darkMode = theme?.darkMode ?? true;
    const uiScale = theme?.uiScale ?? "small";
    root.dataset.mode = darkMode ? "dark" : "light";
    root.dataset.uiScale = uiScale;
    root.style.setProperty("--world-font", fontByKey(theme?.fontFamily ?? null).cssFamily);
    if (theme?.accentColor) root.style.setProperty("--accent", theme.accentColor);
    else root.style.removeProperty("--accent");
    if (theme?.surfaceColor) root.style.setProperty("--surface-base", theme.surfaceColor);
    else root.style.removeProperty("--surface-base");
  }, [theme]);

  return <>{children}</>;
}
