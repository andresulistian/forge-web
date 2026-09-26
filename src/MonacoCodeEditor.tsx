import Editor, { loader, type OnMount } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
// Relative worker imports deliberately bypass Monaco's restrictive package exports.
// Vite still bundles each worker as a local asset, so the editor never needs a CDN.
import editorWorker from "../node_modules/monaco-editor/esm/vs/editor/editor.worker.js?worker";
import jsonWorker from "../node_modules/monaco-editor/esm/vs/language/json/json.worker.js?worker";
import cssWorker from "../node_modules/monaco-editor/esm/vs/language/css/css.worker.js?worker";
import htmlWorker from "../node_modules/monaco-editor/esm/vs/language/html/html.worker.js?worker";
import tsWorker from "../node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js?worker";

self.MonacoEnvironment = {
  getWorker(_moduleId: string, label: string) {
    if (label === "json") return new jsonWorker();
    if (["css", "scss", "less"].includes(label)) return new cssWorker();
    if (["html", "handlebars", "razor"].includes(label))
      return new htmlWorker();
    if (["typescript", "javascript"].includes(label)) return new tsWorker();
    return new editorWorker();
  },
};
loader.config({ monaco });

const languageFor = (file: string) => {
  const extension = file.split(".").pop()?.toLowerCase();
  return (
    (
      {
        ts: "typescript",
        tsx: "typescript",
        js: "javascript",
        jsx: "javascript",
        mjs: "javascript",
        cjs: "javascript",
        json: "json",
        css: "css",
        scss: "scss",
        html: "html",
        md: "markdown",
        py: "python",
        rs: "rust",
        toml: "ini",
        yaml: "yaml",
        yml: "yaml",
        sh: "shell",
      } as Record<string, string>
    )[extension || ""] || "plaintext"
  );
};

export default function MonacoCodeEditor({
  file,
  value,
  theme,
  onChange,
  onSave,
}: {
  file: string;
  value: string;
  theme: "dark" | "light";
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const mount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, onSave);
    editor.focus();
  };

  return (
    <div className="monaco-shell" aria-label={`Editor kode ${file}`}>
      <Editor
        height="100%"
        path={file}
        language={languageFor(file)}
        value={value}
        theme={theme === "light" ? "light" : "vs-dark"}
        onMount={mount}
        onChange={(next) => onChange(next ?? "")}
        loading={<div className="editor-loading">Memuat Monaco Editor…</div>}
        options={{
          automaticLayout: true,
          bracketPairColorization: { enabled: true },
          fontFamily: "JetBrains Mono, SFMono-Regular, Consolas, monospace",
          fontSize: 13,
          formatOnPaste: true,
          minimap: { enabled: false },
          padding: { top: 14, bottom: 14 },
          renderWhitespace: "selection",
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          tabSize: 2,
          wordWrap: "off",
        }}
      />
    </div>
  );
}
