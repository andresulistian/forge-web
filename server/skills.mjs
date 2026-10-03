import { randomUUID } from "node:crypto";
import { DESIGN_SKILLS } from "./design-skills.mjs";

export const BUILTIN_SKILLS = [
  ...DESIGN_SKILLS,
  {
    id: "debug",
    command: "/debug",
    name: "Debug",
    description: "Cari akar masalah, reproduksi, perbaiki, lalu jalankan test relevan.",
    prompt:
      "Skill Debug aktif. Reproduksi masalah terlebih dahulu, kumpulkan bukti, temukan akar penyebab, terapkan perbaikan terkecil yang aman, lalu jalankan test relevan. Jangan menebak hasil test.",
  },
  {
    id: "test",
    command: "/test",
    name: "Test",
    description: "Tambahkan atau jalankan test yang membuktikan perilaku penting.",
    prompt:
      "Skill Test aktif. Identifikasi perilaku yang harus dilindungi, buat atau perbarui test yang fokus, jalankan test terkait, dan laporkan hasil faktual termasuk kegagalan yang tersisa.",
  },
  {
    id: "refactor",
    command: "/refactor",
    name: "Refactor",
    description: "Rapikan kode tanpa mengubah perilaku yang terlihat pengguna.",
    prompt:
      "Skill Refactor aktif. Pertahankan perilaku publik, buat perubahan kecil dan mudah ditinjau, hindari perluasan scope, lalu verifikasi dengan test/build yang sesuai.",
  },
  {
    id: "security-check",
    command: "/security-check",
    name: "Security Check",
    description: "Audit input, secret, akses file, network, dan dependency berisiko.",
    prompt:
      "Skill Security Check aktif. Periksa boundary input, secret, path traversal, command execution, network, dependency, dan authorization. Jangan membuka atau menampilkan secret. Prioritaskan temuan berdasarkan dampak dan buktikan perbaikan dengan test.",
  },
  {
    id: "deploy",
    command: "/deploy",
    name: "Deploy Ready",
    description: "Siapkan proyek agar lolos build, Security Gate, dan deploy.",
    prompt:
      "Skill Deploy Ready aktif. Validasi konfigurasi produksi, build, environment variables tanpa membaca nilainya, health check, dan Security Gate. Jangan melakukan deploy eksternal tanpa persetujuan eksplisit.",
  },
];

const clean = (value, max) => String(value || "").trim().slice(0, max);

export class Skills {
  constructor(store) {
    this.store = store;
  }

  list(projectId) {
    const custom = this.store.setting("skills", projectId) || [];
    return [
      ...BUILTIN_SKILLS.filter(
        (item) => !custom.some((saved) => saved.command === item.command),
      ).map((item) => ({ ...item, builtin: true })),
      ...custom,
    ];
  }

  save(projectId, input) {
    const name = clean(input.name, 60);
    const command = clean(input.command, 40).toLowerCase();
    const description = clean(input.description, 180);
    const prompt = clean(input.prompt, 6000);
    if (!name || !/^\/[a-z0-9][a-z0-9-]{1,38}$/.test(command) || !prompt)
      throw Error("Skill memerlukan nama, command /huruf-kecil, dan instruksi.");
    if (
      BUILTIN_SKILLS.some((item) => item.command === command) &&
      !(this.store.setting("skills", projectId) || []).some(
        (item) => item.id === input.id && item.command === command,
      )
    )
      throw Error("Command tersebut merupakan skill bawaan Forge.");
    const current = this.store.setting("skills", projectId) || [];
    const previous = current.find(
      (item) => item.id === input.id || item.command === command,
    );
    const skill = {
      id: previous?.id || randomUUID(),
      name,
      command,
      description,
      prompt,
      builtin: false,
      updatedAt: Date.now(),
    };
    this.store.setSetting("skills", projectId, [
      ...current.filter((item) => item.id !== skill.id),
      skill,
    ]);
    return skill;
  }

  remove(projectId, id) {
    const current = this.store.setting("skills", projectId) || [];
    this.store.setSetting(
      "skills",
      projectId,
      current.filter((item) => item.id !== id),
    );
    return { ok: true };
  }

  resolve(projectId, text) {
    const trimmed = String(text || "").trim();
    const command = trimmed.split(/\s+/, 1)[0].toLowerCase();
    const skill = this.list(projectId).find((item) => item.command === command);
    if (!skill) return { text, skill: null, instructions: "" };
    return {
      text: trimmed.slice(command.length).trim() || skill.description,
      skill,
      instructions: `\n\nReusable Forge skill ${skill.command} (${skill.name}):\n${skill.prompt}`,
    };
  }
}
