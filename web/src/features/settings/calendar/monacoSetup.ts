// Self-hosted Monaco: no CDN loader (works offline / under CSP). A custom DSL
// needs only the base editor worker — the TS/JSON/CSS language workers are not
// pulled in. Imported for side effects by DslEditor before the editor mounts.

import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { loader } from "@monaco-editor/react";

(globalThis as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker: () => new editorWorker(),
};

loader.config({ monaco });
