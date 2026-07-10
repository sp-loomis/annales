import {
  REGEX_INLINE_MATH_DOLLARS,
  createMathView,
  insertMathCmd,
  makeInlineMathInputRule,
  mathBackspaceCmd,
  mathPlugin,
} from "@benrbray/prosemirror-math";
import { Extension, Node } from "@tiptap/core";
import type { NodeViewRendererProps } from "@tiptap/core";
import {
  chainCommands,
  deleteSelection,
  joinBackward,
  selectNodeBackward,
} from "@tiptap/pm/commands";
import { inputRules } from "@tiptap/pm/inputrules";
import { keymap } from "@tiptap/pm/keymap";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    math: {
      insertInlineMath: (initialText?: string) => ReturnType;
    };
  }
}

export const MathInlineNode = Node.create({
  name: "math_inline",
  group: "inline math",
  content: "text*",
  inline: true,
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: "math-inline" }];
  },

  renderHTML() {
    return ["math-inline", { class: "math-node" }, 0];
  },

  addNodeView() {
    const makeView = createMathView(false);
    return (props: NodeViewRendererProps) =>
      makeView(props.node, props.view, props.getPos, props.decorations, props.innerDecorations);
  },
});

export const MathCommands = Extension.create({
  name: "mathCommands",

  addCommands() {
    return {
      insertInlineMath:
        (initialText = "") =>
        ({ state, dispatch }) => {
          const nodeType = state.schema.nodes.math_inline;
          if (!nodeType) return false;
          return insertMathCmd(nodeType, initialText)(state, dispatch);
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-m": () => this.editor.commands.insertInlineMath(),
    };
  },

  addProseMirrorPlugins() {
    const inlineNode = this.editor.schema.nodes.math_inline;
    if (!inlineNode) return [mathPlugin];

    return [
      mathPlugin,
      keymap({
        Backspace: chainCommands(
          deleteSelection,
          mathBackspaceCmd,
          joinBackward,
          selectNodeBackward
        ),
      }),
      inputRules({
        rules: [makeInlineMathInputRule(REGEX_INLINE_MATH_DOLLARS, inlineNode)],
      }),
    ];
  },
});
