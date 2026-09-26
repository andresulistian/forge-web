import fs from "node:fs/promises";
import path from "node:path";

export function validateGuide(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("Rencana backend tidak valid.");
  const data = String(input.data || "").trim();
  if (data.length > 80 || /[\r\n<>`]/.test(data))
    throw Error("Nama data tidak valid.");
  if (typeof input.auth !== "boolean" || typeof input.api !== "boolean")
    throw Error("Pilihan backend tidak valid.");
  return { data, auth: input.auth, api: input.api };
}

async function safeFile(project, name) {
  const file = path.join(project.path, name);
  try {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile()) return false;
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export class BackendGuide {
  constructor(store) {
    this.store = store;
  }
  async inspect(project, deployConfig) {
    let pkg = {};
    if (await safeFile(project, "package.json")) {
      try {
        const content = await fs.readFile(
          path.join(project.path, "package.json"),
          "utf8",
        );
        if (content.length <= 100000) pkg = JSON.parse(content);
      } catch {
        /* proyek statis / manifest tidak valid */
      }
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const detected = [
      deps["@supabase/supabase-js"] && "Supabase SDK",
      (deps.firebase || deps["firebase-admin"]) && "Firebase SDK",
      (deps.prisma || deps["@prisma/client"]) && "Prisma",
      deps["drizzle-orm"] && "Drizzle",
      deps.expo && "Expo",
      (deps.next || deps["@remix-run/react"]) && "Framework web server",
      (await safeFile(project, "supabase/config.toml")) && "Supabase CLI",
      (await safeFile(project, "firebase.json")) && "Firebase config",
    ].filter(Boolean);
    const config = this.store.setting("backend-guide", project.id) || {
      data: "",
      auth: false,
      api: false,
    };
    const provider = deployConfig.database;
    const notes =
      provider === "supabase"
        ? [
            "Buat tabel lewat migration dan aktifkan Row Level Security pada setiap tabel yang diekspos.",
            "Buat policy sesuai pemilik data; service role key hanya di server, jangan di bundle browser.",
          ]
        : provider === "firebase"
          ? [
              "Buat struktur koleksi dan Firebase Security Rules; uji akses pengguna dan anonim.",
              "Kunci admin hanya di server; konfigurasi klien harus disertai aturan akses yang ketat.",
            ]
          : provider === "local"
            ? [
                "Data tersimpan di perangkat/browser dan tidak otomatis tersinkron antar pengguna.",
                "Jika butuh API publik atau akun lintas perangkat, pilih database cloud terlebih dahulu.",
              ]
            : [
                "Pilih database di pengaturan deploy dan simpan sebelum membuat rencana.",
              ];
    const steps =
      provider === "none"
        ? []
        : [
            "Periksa struktur proyek dan jalur akses data yang sudah ada.",
            `Rancang ${config.data || "entitas data utama"} dan operasi baca/tulis berdasarkan kebutuhan pengguna.`,
            ...(config.auth
              ? ["Tambahkan autentikasi dan batasi akses per pengguna."]
              : []),
            ...(config.api
              ? [
                  "Siapkan endpoint/server functions sesuai framework dan hosting yang dipakai.",
                ]
              : []),
            ...notes,
            "Buat contoh environment variable tanpa nilai rahasia, tes perilaku akses, dan jalankan pemeriksaan lokal.",
          ];
    const prompt =
      provider === "none"
        ? ""
        : [
            `Siapkan backend dan database ${provider} untuk proyek ${project.name}.`,
            `Hosting: ${deployConfig.hosting}. Stack terdeteksi: ${detected.join(", ") || "periksa langsung source proyek"}.`,
            `Data utama: ${config.data || "periksa kebutuhan aplikasi terlebih dahulu; jangan mengarang skema bisnis"}.`,
            `Autentikasi: ${config.auth ? "diperlukan" : "belum diminta"}. API/server functions: ${config.api ? "diperlukan" : "belum diminta"}.`,
            ...steps.map((step, index) => `${index + 1}. ${step}`),
            "Buat checkpoint sebelum mengubah file. Jangan baca, cetak, atau commit kredensial; jangan deploy. Jika butuh proyek layanan eksternal atau nilai kredensial, jelaskan langkahnya dan minta pengguna mengisinya melalui mekanisme rahasia. Pertahankan fitur yang sudah ada; jalankan tes relevan dan jelaskan hasil serta pekerjaan manual yang tersisa.",
          ].join("\n");
    return { config, provider, detected, notes, steps, prompt };
  }
  async save(project, input, deployConfig) {
    const config = validateGuide(input);
    this.store.setSetting("backend-guide", project.id, config);
    return this.inspect(project, deployConfig);
  }
}
