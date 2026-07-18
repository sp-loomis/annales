// Registers the "sheafdsl" language with Monaco: Monarch highlighting, a
// scope-aware completion provider, and a type-check lint that runs the real
// backend compiler (compileRule) so in-editor diagnostics match the server.

import type * as MonacoNS from "monaco-editor";
import { compileRule, DslError, FUNCTION_NAMES, KEYWORDS } from "@dsl";
import { scopeIdentifiers, type DslScope } from "./dslScope";

export const DSL_LANG_ID = "sheafdsl";

// Overflow widgets (autocomplete, hover) render here — a body-level node OUTSIDE
// the dialog. The dialog centres with `transform`, which would otherwise offset
// Monaco's position:fixed widgets away from the cursor. High z-index so they sit
// above the dialog (41) and popovers (≤70).
let overflowNode: HTMLElement | null = null;
export function overflowWidgetsDomNode(): HTMLElement {
  if (!overflowNode) {
    overflowNode = document.createElement("div");
    overflowNode.className = "monaco-editor sheaf-dsl-overflow";
    overflowNode.style.position = "absolute";
    overflowNode.style.top = "0";
    overflowNode.style.left = "0";
    overflowNode.style.zIndex = "1000";
    document.body.appendChild(overflowNode);
  }
  return overflowNode;
}

// Each editor model carries its own field scope (different vars / return type).
const modelScopes = new WeakMap<MonacoNS.editor.ITextModel, DslScope>();
let registered = false;

export function setModelScope(model: MonacoNS.editor.ITextModel, scope: DslScope): void {
  modelScopes.set(model, scope);
}

export function registerSheafDsl(monaco: typeof MonacoNS): void {
  if (registered) return;
  registered = true;

  monaco.languages.register({ id: DSL_LANG_ID });

  monaco.languages.setLanguageConfiguration(DSL_LANG_ID, {
    comments: { lineComment: "#" },
    brackets: [["(", ")"]],
    autoClosingPairs: [
      { open: "(", close: ")" },
      { open: '"', close: '"' },
    ],
    surroundingPairs: [
      { open: "(", close: ")" },
      { open: '"', close: '"' },
    ],
  });

  monaco.languages.setMonarchTokensProvider(DSL_LANG_ID, {
    keywords: [...KEYWORDS.keys()],
    functions: [...FUNCTION_NAMES],
    tokenizer: {
      root: [
        [/#.*$/, "comment"],
        [
          /[A-Za-z][A-Za-z0-9_]*/,
          { cases: { "@keywords": "keyword", "@functions": "type.identifier", "@default": "identifier" } },
        ],
        [/\d+\.\d+|\d+/, "number"],
        [/:=|!=|<=|>=|[=<>+\-*/%]/, "operator"],
        [/[(),:]/, "delimiter"],
        [/"/, { token: "string.quote", next: "@string" }],
        [/\s+/, "white"],
      ],
      string: [
        [/[^"{\\]+/, "string"],
        [/\\./, "string.escape"],
        [/\{/, { token: "delimiter.curly", next: "@interp" }],
        [/"/, { token: "string.quote", next: "@pop" }],
      ],
      interp: [
        [/[^}]+/, "identifier"],
        [/\}/, { token: "delimiter.curly", next: "@pop" }],
      ],
    },
  });

  monaco.languages.registerCompletionItemProvider(DSL_LANG_ID, {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range: MonacoNS.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const Kind = monaco.languages.CompletionItemKind;
      const suggestions: MonacoNS.languages.CompletionItem[] = [];
      const push = (
        label: string,
        kind: MonacoNS.languages.CompletionItemKind,
        detail: string,
        insertText: string = label
      ) => suggestions.push({ label, kind, detail, insertText, range });

      for (const kw of KEYWORDS.keys()) push(kw, Kind.Keyword, "keyword");
      for (const fn of FUNCTION_NAMES) {
        suggestions.push({
          label: fn,
          kind: Kind.Function,
          detail: "function",
          insertText: `${fn}($0)`,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
        });
      }

      const scope = modelScopes.get(model);
      if (scope) {
        const { vars, domainValues } = scopeIdentifiers(scope);
        for (const v of vars) push(v, Kind.Variable, "parameter");
        for (const dv of domainValues) push(dv, Kind.EnumMember, "named value");
      }

      // Locals defined earlier with `name :=` in this formula body.
      const localRe = /(?:^|\n)[ \t]*([A-Za-z][A-Za-z0-9_]*)[ \t]*:=/g;
      const text = model.getValue();
      const seen = new Set<string>();
      for (let m = localRe.exec(text); m !== null; m = localRe.exec(text)) {
        if (!seen.has(m[1])) {
          seen.add(m[1]);
          push(m[1], Kind.Variable, "local");
        }
      }
      return { suggestions };
    },
  });
}

export interface LintResult {
  errors: string[];
  warnings: string[];
}

/**
 * Recompile the model's source in its scope, publish DslError/warnings as
 * Monaco markers, and return the messages so the caller can also show them as
 * always-visible text (the marker hover alone can be clipped by a small box).
 */
export function lintModel(monaco: typeof MonacoNS, model: MonacoNS.editor.ITextModel): LintResult {
  const result: LintResult = { errors: [], warnings: [] };
  const scope = modelScopes.get(model);
  if (!scope) return result;
  const source = model.getValue();
  const markers: MonacoNS.editor.IMarkerData[] = [];

  if (source.trim()) {
    try {
      const rule = compileRule(source, scope.env, scope.expected);
      const lastLine = model.getLineCount();
      for (const w of rule.warnings) {
        result.warnings.push(w);
        markers.push({
          severity: monaco.MarkerSeverity.Warning,
          message: w,
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: lastLine,
          endColumn: model.getLineMaxColumn(lastLine),
        });
      }
    } catch (err) {
      if (err instanceof DslError) {
        result.errors.push(err.message);
        const line = err.pos?.line ?? 1;
        const col = err.pos?.col ?? 1;
        markers.push({
          severity: monaco.MarkerSeverity.Error,
          message: err.message,
          startLineNumber: line,
          startColumn: col,
          endLineNumber: line,
          endColumn: col + 1,
        });
      } else {
        throw err;
      }
    }
  }

  monaco.editor.setModelMarkers(model, DSL_LANG_ID, markers);
  return result;
}
