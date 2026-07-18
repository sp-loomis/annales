// Controlled Monaco editor for a single DSL formula. Highlighting, scope-aware
// autocomplete, and live type-check linting come from dslLanguage. Loaded lazily
// (heavy chunk) by DefinitionForm. Re-lints on edit and whenever its scope
// changes (e.g. a param upstream is renamed/retyped).

import { useEffect, useRef, useState } from "react";
import Editor, { type OnChange, type OnMount, type Monaco } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import "./monacoSetup";
import {
  DSL_LANG_ID,
  lintModel,
  overflowWidgetsDomNode,
  registerSheafDsl,
  setModelScope,
} from "./dslLanguage";
import type { DslScope } from "./dslScope";
import styles from "./DslEditor.module.css";

const LINT_DEBOUNCE_MS = 250;

function editorTheme(): string {
  return document.documentElement.dataset.mode === "light" ? "vs" : "vs-dark";
}

export interface DslEditorProps {
  value: string;
  onChange: (value: string) => void;
  scope: DslScope;
  height?: number;
  testId?: string;
}

export default function DslEditor({ value, onChange, scope, height = 120, testId }: DslEditorProps) {
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const timer = useRef<number | null>(null);
  const [issues, setIssues] = useState<{ errors: string[]; warnings: string[] }>({
    errors: [],
    warnings: [],
  });

  const relint = () => {
    const monaco = monacoRef.current;
    const model = editorRef.current?.getModel();
    if (monaco && model) setIssues(lintModel(monaco, model));
  };

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    registerSheafDsl(monaco);
    const model = editor.getModel();
    if (model) {
      monaco.editor.setModelLanguage(model, DSL_LANG_ID);
      setModelScope(model, scope);
      setIssues(lintModel(monaco, model));
    }
  };

  const handleChange: OnChange = (next) => {
    onChange(next ?? "");
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(relint, LINT_DEBOUNCE_MS);
  };

  // Scope shifts when the surrounding definition changes; re-apply and re-lint.
  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (model) {
      setModelScope(model, scope);
      relint();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  return (
    <div className={styles.field} data-testid={testId}>
      {/* Drag the bottom edge to grow the box. */}
      <div className={styles.wrap} style={{ height }}>
        <Editor
          language={DSL_LANG_ID}
          theme={editorTheme()}
          value={value}
          onMount={handleMount}
          onChange={handleChange}
          options={{
            minimap: { enabled: false },
            lineNumbers: "off",
            folding: false,
            fontSize: 13,
            scrollBeyondLastLine: false,
            wordWrap: "on",
            automaticLayout: true,
            overviewRulerLanes: 0,
            scrollbar: { vertical: "auto", horizontal: "hidden" },
            renderLineHighlight: "none",
            padding: { top: 6, bottom: 6 },
            // Render hovers/autocomplete/marker tooltips in a body-level node
            // (see overflowWidgetsDomNode) so they escape the small editor box
            // and the dialog's scroll areas, and stay anchored to the cursor
            // despite the dialog's centering transform.
            fixedOverflowWidgets: true,
            overflowWidgetsDomNode: overflowWidgetsDomNode(),
          }}
        />
      </div>
      {issues.errors.map((e, i) => (
        <p key={`e${i}`} className={styles.issueError}>
          {e}
        </p>
      ))}
      {issues.warnings.map((w, i) => (
        <p key={`w${i}`} className={styles.issueWarn}>
          {w}
        </p>
      ))}
    </div>
  );
}
