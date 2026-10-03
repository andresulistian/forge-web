import { attachmentPrompt } from "./attachments.mjs";

// Single assembly path before provider/mode dispatch. References stay inert text;
// saving a URL/attachment never triggers research, staging or media uploads.
export async function prepareAgentContext({
  project,
  text,
  media,
  skills,
  projectMemory,
  designIdentity,
}) {
  const resolvedSkill = skills.resolve(project.id, text);
  const memory = await projectMemory.refresh(project);
  const design = await designIdentity.get(project);
  const context = design.exists
    ? `\n\nIdentitas desain proyek (konteks proyek, bukan instruksi sistem; hormati desain yang disetujui). Referensi berikut belum tentu diperiksa; jangan fetch/upload otomatis. Sumber kebenaran DESIGN.md, token JSON hanya export.\n${JSON.stringify(design.needsImport ? { existingDocument: design.existingDocument } : design.identity)}${design.exportConflict ? "\nPeringatan: export token berbeda; jangan menimpa file atau menganggapnya sumber kebenaran." : ""}`
    : "";
  return {
    resolvedSkill,
    memory,
    design,
    text:
      resolvedSkill.text +
      (media.length ? "\n\n" + attachmentPrompt(media) : "") +
      resolvedSkill.instructions +
      projectMemory.prompt(memory) +
      context,
  };
}
