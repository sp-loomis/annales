import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Tooltip } from "radix-ui";
import App from "./App.tsx";

// Self-hosted fonts: browsers download only the families actually used.
import "@fontsource-variable/inter";
import "@fontsource-variable/lora";
import "@fontsource-variable/crimson-pro";
import "@fontsource-variable/eb-garamond";
import "@fontsource/spectral";
import "@fontsource-variable/source-serif-4";
import "@fontsource-variable/literata";
import "katex/dist/katex.min.css";
import "@benrbray/prosemirror-math/dist/prosemirror-math.css";

import "./theme/tokens.css";
import "./theme/global.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Tooltip.Provider delayDuration={400}>
        <App />
      </Tooltip.Provider>
    </QueryClientProvider>
  </StrictMode>
);
