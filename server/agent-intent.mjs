export function needsProjectInspection(text) {
  return /(?:\b(?:project|proyek|workspace|file|folder|kode|code|source|komponen|component|fungsi|function|bug|error|stack|build|dependency|package|html|css|javascript|typescript|react|database|deploy)\b|\b(?:jalankan|run|periksa|check)\s+(?:test|tests|pengujian)\b|(?:^|\s)[\w./-]+\.(?:js|jsx|ts|tsx|mjs|cjs|json|html|css|md|py|go|rs|java|php)\b)/i.test(String(text || ""));
}

export function turnActivity(mode, text, provider) {
  const inspectProject = mode !== "ask" || needsProjectInspection(text);
  return {
    inspectProject,
    stage: inspectProject ? "inspecting-project" : "waiting-provider",
    label: inspectProject ? "Inspecting project" : `Menunggu ${provider}`,
  };
}

export function askInstruction(inspectProject) {
  return inspectProject
    ? "Use read-only tools only when needed to answer the user's explicit question about the project. Do not modify files or execute mutating commands."
    : "Answer this general question directly. Do not inspect project files and do not call tools.";
}
