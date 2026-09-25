# Forge Web

Forge adalah AI app builder personal yang berjalan di browser, dengan **local companion** Node.js di komputer Anda. UI ada di browser, sedangkan akses file, terminal, Git, preview, SQLite, credential, dan coding agent tetap berjalan lokal.

## Yang sudah tersedia

- Project picker: buat proyek starter atau buka folder lokal dengan path absolut.
- Chat dengan mode **Ask / Plan / Build** dan streaming activity.
- Forge Guide dapat dipilih terpisah antara Ollama lokal dan model OpenRouter yang sudah ditambahkan di Settings. Riwayat Guide tetap per proyek ketika provider diganti.
- Coding agent: Codex, Gemini CLI, dan Ollama lokal.
- Bonsai 2 27B melalui `llama.cpp` lokal di Mac; Ask / Plan / Build dan Forge Guide memakai model dari server `/v1/models`.
- API provider tambahan: Anthropic Claude untuk Ask/Plan serta OpenRouter untuk Ask/Plan/Build pada model yang mendukung tool calling.
- Monaco Editor lokal, file explorer, save conflict protection, dan checkpoint otomatis.
- Terminal proyek dengan persetujuan eksplisit dan output di Activity.
- Live preview dalam iframe, desktop/mobile width, start/stop/refresh.
- Uji browser untuk Preview lokal: buka halaman, klik tombol, isi input, periksa teks, dan tampilkan error JavaScript/HTTP. Bisa dijalankan otomatis setelah Build selesai.
- Approval sensitif, Git checkpoint/restore, dan history/config di SQLite.
- GitHub import serta commit/push backup melalui `gh` CLI tanpa force-push.
- Sync / Pull mengambil commit baru pada branch aktif dengan fast-forward saja; perubahan lokal atau riwayat berbeda ditolak.
- Indikator penggunaan: persentase kuota Codex dalam jendela waktu serta token konteks Gemini jika CLI mengirimnya.
- MCP stdio registry, scope global/proyek, connection test, dan capability discovery.
- Deploy Center untuk alur Vercel/Cloudflare Pages dan EAS yang selalu meminta konfirmasi, dengan Security Audit sebelum deploy.
- Riwayat rilis per proyek di Deploy Center dan rollback deployment produksi web yang dikonfirmasi; catatan build mobile tersimpan terpisah.
- Monitoring HTTPS situs pascadeploy, dengan pemeriksaan berkala saat Forge berjalan dan riwayat 30 hasil per proyek.
- Panduan backend/database membaca stack proyek dan menyiapkan rencana Build untuk Supabase, Firebase, atau penyimpanan lokal.
- Pencarian web bersama untuk Ask, Plan, Build, dan Forge Guide, dengan tautan sumber di riwayat chat.
- Backup otomatis saat Forge dibuka dan pemulihan satu klik di Settings → Backup & pemulihan.

## Backup dan pemulihan

Buka **Settings → Backup & pemulihan Forge** untuk **Buat backup sekarang** atau **Pulihkan** dari tanggal tertentu. Forge juga mencoba membuat backup otomatis saat dibuka, maksimal sekali sehari ketika ada proyek. Snapshot berada di luar folder instalasi: `~/Library/Application Support/Forge Web/backups/` pada macOS atau `~/.local/share/forge-web/backups/` pada Linux. Lokasinya dapat diubah dengan `FORGE_BACKUP_DIR`, asalkan bukan di dalam folder data atau proyek Forge. Jangan hapus folder backup saat mengganti source Forge.

Snapshot menyimpan database proyek/chat/pengaturan, proyek yang dibuat Forge dan proyek eksternal yang terdaftar, lampiran, serta riwayat checkpoint. Forge memeriksa isi dan checksum sebelum memulihkan. Saat restore, Forge lebih dahulu membuat snapshot kondisi sekarang; proyek yang dipulihkan ditempatkan di folder baru di bawah `.forge/projects/`, sedangkan folder proyek lama yang berada di luar instalasi tidak ditimpa. Pemulihan dapat dilakukan juga dari instalasi source baru di komputer yang sama, selama folder backup tetap ada.

Snapshot lokal bisa mengandung kode dan file konfigurasi rahasia. Jaga akses ke folder backup. API key yang disimpan di macOS Keychain/Linux Secret Service serta `.env` milik instalasi Forge tidak disalin ke snapshot. `node_modules`, `dist`, cache build, dan tautan simbolik di dalam proyek tidak disalin; instal ulang dependensi bila diperlukan. Batas satu snapshot adalah 25.000 file atau 2 GB; Forge menolak backup yang terlalu besar tanpa menyimpan snapshot parsial. Jika backup otomatis gagal, lihat keluaran Terminal Forge.

## Pencarian web

Buka **Settings → Web Search**, buat [Brave Search API key](https://api-dashboard.search.brave.com/app/documentation/web-search/get-started), tempel dan klik **Simpan key**. Pada macOS key disimpan di Keychain; pada Linux gunakan Secret Service/libsecret. Klik **Uji pencarian** untuk memastikan koneksi. Tersedia juga `FORGE_BRAVE_SEARCH_API_KEY` untuk konfigurasi melalui environment; jangan memasukkannya ke repository.

Di chat pilih **Web · Otomatis** untuk mencari saat pertanyaan mengandung kebutuhan informasi terbaru atau URL publik; **Web · Cari** untuk selalu mencari; dan **Web · Offline** untuk tidak mengirim pertanyaan ke Brave. Pilihan berlaku pula di Forge Guide. Hasil pencarian dan tanggal pemeriksaan tersimpan di riwayat chat; klik sumber untuk memeriksa klaim. Pencarian tidak otomatis menambah kemampuan tool milik model: Forge mengirimkan hasil web sebagai konteks bersama ke model yang dipilih.

Pertanyaan pencarian dikirim ke Brave Search. Forge mencoba membaca dua halaman publik pertama melalui HTTPS dan membatasi ukuran/jenis konten; situs yang menolak akses tetap dapat muncul sebagai ringkasan hasil pencarian. Jangan sertakan kata sandi, API key, atau data pribadi dalam pertanyaan web. Jika pencarian gagal, Forge menampilkan keterbatasannya dan tidak mengklaim data telah diperbarui. Brave Search API mungkin memiliki biaya atau batas kuota sesuai akun Anda.

## Security Audit dan Fix

Di **Deploy Center → Security Audit**, Forge memindai source dan dependensi, lalu menampilkan temuan beserta tindakan yang disarankan. Klik **Perbaiki dengan Agent** untuk menyiapkan instruksi di chat Build; tinjau dan kirim instruksinya, lalu kembali untuk **Pindai ulang**. Kredensial yang terlanjur terpapar harus dirotasi di layanan terkait. Forge tidak menampilkan nilai kredensial dalam laporan dan tidak menjalankan deploy selama perbaikan.

Backend mengulang audit sebelum perintah deploy atau submit, termasuk saat dipanggil melalui API. Untuk web, hasil build atau staging diperiksa lagi sebelum upload. Temuan high/critical, kegagalan audit, atau file sensitif dalam paket upload memblokir deploy. File `.env` lokal yang tidak ikut upload Cloudflare dicatat sebagai peringatan; Vercel dan EAS memblokirnya karena source dikirim ke provider.

Proyek npm dengan dependensi memerlukan `package-lock.json` dan akses npm registry untuk menjalankan `npm audit --omit=dev`. Jika audit tidak dapat diselesaikan, deploy ditahan sampai pemeriksaan berhasil. Audit berbasis pola dan advisory npm tidak menggantikan review akses backend, database, dan konfigurasi layanan.

## Riwayat rilis dan rollback web

Buka **Deploy Center → Riwayat rilis**. Forge mencatat deploy berhasil/gagal dalam SQLite, terpisah per proyek dan layanan. Untuk melihat rilis lama termasuk yang dibuat di luar Forge dan mengaktifkan tombol **Rollback**, jalankan Forge dengan `CLOUDFLARE_API_TOKEN` dan `CLOUDFLARE_ACCOUNT_ID` (izin Pages Read/Write) atau `VERCEL_TOKEN`. Bila proyek Vercel berada di tim, tambahkan `VERCEL_ORG_ID`. Tanpa token, riwayat lokal tetap terlihat, tetapi Forge tidak dapat memverifikasi deployment online untuk rollback. Simpan pilihan hosting dan nama situs yang benar terlebih dahulu.

Rollback memerlukan konfirmasi tersendiri dan hanya tersedia bagi deployment **produksi** yang sukses. Cloudflare memakai API Pages; Vercel memakai CLI rollback. [Vercel Hobby](https://vercel.com/docs/cli/rollback) membatasi rollback ke deployment produksi sebelumnya. Preview tidak dapat di-rollback ke produksi melalui tombol ini. Rollback mengganti rilis online, tetapi tidak mengubah source di komputer atau isi database aplikasi. iOS dan Android menampilkan catatan build/submit Forge; rilis App Store/Play Store tidak mendukung rollback instan melalui fitur ini.

## Monitoring situs pascadeploy

Di **Deploy Center → Monitoring situs setelah deploy**, isi URL HTTPS situs yang digunakan pengguna, misalnya domain produksi. Anda dapat mengisi teks halaman yang wajib muncul, memilih interval 5–60 menit, lalu mengaktifkan pemeriksaan berkala. Klik **Periksa sekarang** untuk uji manual. Forge mencatat status HTTP, waktu respons, dan 30 hasil terakhir per proyek di database lokal. Saat monitoring aktif, Forge memeriksa lagi sesudah deploy web berhasil dan setiap interval **selama Forge berjalan**. Forge hanya menerima alamat publik dan tidak mengikuti pengalihan; jika situs memakai redirect, masukkan URL tujuan akhirnya. Monitoring tidak mengirim peringatan eksternal dan tidak melakukan rollback otomatis. Pemeriksaan HTTP tidak memastikan seluruh fungsi aplikasi dan backend sehat; untuk itu gunakan endpoint kesehatan aplikasi dan uji fungsional tersendiri.

## Menghapus proyek di macOS

Pilih proyek lalu klik **Hapus proyek** di bagian atas. **Hapus dari Forge saja** menghapus daftar proyek, chat, memory agent, checkpoint, dan konfigurasi lokal terkait, tetapi mempertahankan folder source. **Folder dan semua file** memindahkan folder proyek yang dipilih ke Trash macOS lalu membersihkan data lokal terkait. Ketik nama proyek dengan tepat sebagai konfirmasi. Agent, terminal, preview, dan deploy proyek harus dihentikan lebih dahulu; preview akan dihentikan otomatis. Folder root, home, data Forge, folder induk proyek Forge, dan template tidak dapat menjadi target. Backup Forge yang sudah ada tidak ikut dihapus. Folder pada volume eksternal mungkin perlu dihapus melalui Finder apabila macOS tidak dapat memindahkannya ke Trash pengguna.

Untuk menghapus seluruh daftar proyek, klik ikon tempat sampah di samping jumlah proyek pada judul **WORKSPACE**. **Kosongkan Workspace** mempertahankan semua folder source, sedangkan **Workspace dan semua folder** memindahkan setiap folder proyek ke Trash macOS. Konfirmasi dengan mengetik `HAPUS WORKSPACE`. Integrasi, API key, pengaturan global, dan backup Forge tetap disimpan. Demi keamanan, folder proyek bertingkat harus dihapus satu per satu.

## Panduan backend/database

Pilih database di pengaturan Deploy Center lalu klik **Simpan pengaturan**. Isi data utama, kebutuhan login, serta kebutuhan API/server functions pada **Panduan backend & database**. Forge mendeteksi dependensi proyek tanpa membaca file rahasia, menyimpan pilihan per proyek, dan menampilkan rencana sesuai penyedia. Klik **Simpan rencana** kemudian **Tinjau di Build** untuk meninjau instruksi sebelum dikirim ke agent. Panduan meminta migration dan RLS untuk Supabase atau Security Rules untuk Firebase; penyimpanan lokal tidak menyediakan sinkronisasi lintas perangkat. Pembuatan proyek cloud, penambahan kredensial, dan perubahan kode backend dilakukan sesudah instruksi Build ditinjau; memilih database saja tidak memasang koneksi backend atau membuat schema secara otomatis.

## Arsitektur

```mermaid
flowchart TB
  Browser["Browser UI · React + Monaco"] -->|"tokenized localhost API"| Companion["Local Companion · Node.js"]
  Companion --> Data["Files · Git · SQLite · Terminal"]
  Companion --> Agents["Codex · Gemini · Ollama"]
  Companion --> APIs["Claude · OpenRouter"]
  Companion --> Integrations["GitHub CLI · MCP stdio"]
  Companion --> Preview["Local dev server"]
```

Local companion hanya bind ke `127.0.0.1`, memakai token acak per proses, memeriksa Host/Origin, dan tidak menyediakan akses publik.

## Instalasi Nobara Linux

Unduh ZIP Forge untuk Nobara dan jalankan satu per satu di Terminal:

```bash
cd ~/Downloads
unzip Forge-Web-v0.3.1-source.zip
cd forge-web
sudo dnf install nodejs npm git libsecret
bash install-nobara.sh
```

Installer memerlukan Node.js **22.13+**. Periksa dengan `node --version` bila installer melaporkan versi terlalu lama. `npm ci` mengunduh dependency pada pemasangan pertama, jadi perlu internet. Installer menyalin aplikasi ke `~/.local/share/forge-web/app`, lalu membuat menu aplikasi **Forge Web** dan perintah `~/.local/bin/forge-web`. Saat dibuka, Forge menjalankan server lokal dan membuka browser; terminal yang terbuka menghentikan Forge saat ditutup. Untuk memasang versi baru, ulangi `bash install-nobara.sh` dari ZIP yang baru. Data proyek dan pengaturan berada di luar folder kode sehingga tetap ada saat diperbarui.

Model Ollama yang sudah terpasang akan muncul dalam pemilih **Local · Ollama**. Forge memilih `qwen3.5:9b` sebagai awal bila ada; `gemma4:12b` juga dapat dipilih. Periksa model dengan `ollama list`. Forge akan mencoba memulai Ollama saat Local AI dipilih; jika gagal, jalankan `ollama serve` di Terminal terpisah. Model di Forge Guide lokal dipilih otomatis dari model yang tersedia. GitHub melalui `gh` bersifat opsional (`sudo dnf install gh`, lalu `gh auth login`). Codex CLI, Gemini CLI, dan akun OpenRouter juga opsional.

Linux menyimpan API key OpenRouter/Claude melalui `secret-tool` dan Secret Service desktop. Jika penyimpanan key gagal, pastikan keyring pengguna sudah terbuka setelah login ke desktop.

## Bonsai di Mac

Jika Bonsai-demo berada di `~/Bonsai-demo`, pilih **Local · Bonsai 27B** di Forge. Forge akan menjalankan skrip servernya dan menunggu model siap. Jika server sudah berjalan, Forge akan menggunakan server tersebut. Untuk memeriksa model yang aktif:

```sh
curl http://127.0.0.1:8080/v1/models
```

Forge membaca ID model dari respons tersebut; tidak perlu menyalin GGUF ke folder Ollama. Ask, Plan, Build, serta **Forge Guide → Local AI · Bonsai 27B** tersedia. Build tetap meminta persetujuan sebelum penulisan file atau menjalankan command. Riwayat Bonsai dipisahkan dari Ollama; Guide mempertahankan riwayat per proyek saat berpindah provider. Forge menghentikan server yang ia mulai sendiri ketika Bonsai tidak lagi dipilih dan Guide Bonsai ditutup; server yang Anda jalankan sendiri tidak dihentikan.

Jika Bonsai-demo berada di folder lain, set `FORGE_BONSAI_DIR=/path/ke/Bonsai-demo` di `.env`. Jika server Bonsai memakai port lain, set `FORGE_BONSAI_URL=http://127.0.0.1:PORT/v1` di `.env` sebelum menjalankan Forge. Alamat harus berada di localhost. Ketika mengekstrak paket source versi baru ke folder Forge yang sudah ada, folder data `.forge/` dan file `.env` tidak disertakan dalam ZIP dan tetap tersimpan.

## Menjalankan dari source

Prasyarat minimum:

- Node.js 22.13 atau lebih baru.
- Git.
- Untuk Codex: Codex CLI dan login aktif.
- Opsional: Gemini CLI, Ollama, GitHub CLI (`gh`).
- Untuk Bonsai: pasang Bonsai-demo dan modelnya; Forge akan menjalankan server saat Bonsai dipilih.
- API key disimpan di macOS Keychain atau Linux Secret Service (`libsecret`).

```sh
cd forge-web
npm install
npm run app
```

Terminal akan mencetak URL seperti:

```text
Forge siap: http://127.0.0.1:49152/#token=...
```

Buka URL lengkap tersebut. Browser menyimpan token di `sessionStorage`, lalu menghapusnya dari address bar. Jangan membagikan URL bertoken.

Untuk development frontend dengan hot reload, jalankan pada dua Terminal:

```sh
# Terminal 1
npm start

# Terminal 2
npm run dev
```

Gunakan URL backend bertoken untuk penggunaan normal. Dev server Vite pada port 1420 hanya dipakai saat mengembangkan UI Forge.

## Alur pertama

1. Klik **Proyek baru**, atau **Buka folder proyek** dan masukkan path absolut.
2. Pilih provider/model AI.
3. Gunakan Ask untuk bertanya, Plan untuk merancang, dan Build untuk mengedit.
4. Buka **Code** untuk edit manual dengan Monaco dan `⌘S`/`Ctrl+S`.
5. Jalankan command seperti `npm test` dari input Terminal di panel Activity.
6. Klik **Preview → Jalankan** untuk menjalankan `npm run dev` proyek.
7. Gunakan **Checkpoints** untuk restore.

### Uji browser

Jalankan Preview proyek, lalu buka **Uji browser** di bawah tampilan aplikasi dan klik **Jalankan uji**. Pemeriksaan dasar memuat halaman utama dan mendeteksi error JavaScript serta halaman yang kosong. Tambahkan langkah **Buka path**, **Klik**, **Isi input**, atau **Periksa teks** dengan CSS selector seperti `button[type=submit]` dan `h1`. Langkah disimpan per proyek dalam browser Forge; maksimum 12 langkah. Aktifkan **Uji otomatis setelah Build** bila ingin mengulangnya sesudah agent selesai mengubah kode, selama Preview proyek sedang berjalan. Laporan terakhir terlihat di panel yang sama.

Fitur ini menggunakan Google Chrome atau Chromium yang terpasang di komputer, tanpa dependency npm tambahan. Browser penguji memakai profil sementara dan hanya boleh mengakses origin Preview lokal. Gunakan akun dan data uji untuk langkah yang mengisi formulir; klik dapat mengubah data aplikasi yang sedang dijalankan. Bila Chrome tidak tersedia, Forge menampilkan petunjuk pemasangan dan Preview biasa tetap dapat dipakai.

## Provider AI

| Provider | Auth | Ask/Plan | Build |
|---|---|---:|---:|
| OpenAI Codex | Login Codex CLI | Ya | Ya |
| Google Gemini | Login Gemini CLI | Ya | Ya |
| Local Ollama | Instalasi lokal | Ya | Ya, approval per tool |
| Local Bonsai · llama.cpp | Server localhost:8080 | Ya | Ya, approval per tool |
| Anthropic Claude | API key di Keychain / Secret Service | Ya | Belum |
| OpenRouter | API key di Keychain / Secret Service | Ya | Ya, model tool-calling + approval per perubahan |

Pemilihan provider/model selalu eksplisit. Forge tidak melakukan fallback diam-diam ke provider lain.

Tambahkan Claude/OpenRouter melalui **Settings → AI API providers**. Masukkan API key, klik **Load models**, cari model di daftar dan tambahkan hingga 20 model per provider. Model OpenRouter berlabel **Build** mengiklankan dukungan tool calling; model lain tetap tersedia untuk Ask/Plan. Pilih default model dari dropdown lalu simpan. Model yang dipilih tersedia di dropdown chat. Gunakan **Edit models** untuk memperbarui provider tanpa mengetik ulang API key. **Test** memeriksa ID model dan memperbarui capability Build. API key tidak dikirim kembali ke browser atau disimpan dalam SQLite. OpenRouter Build hanya dapat membaca proyek terpilih; setiap penulisan file dan command meminta approval satu kali, dan Forge membuat checkpoint sebelum Build.

Forge Guide memiliki pemilih AI sendiri di bagian atas panel: **Local AI · Ollama** atau koneksi **OpenRouter**. Saat memakai OpenRouter, pilih salah satu model yang sudah ditambahkan di Settings. Guide memakai riwayat per proyek yang sama saat Anda berpindah provider; isi percakapan yang relevan dikirim ke OpenRouter saat Anda memilihnya. Guide hanya menjawab dan membantu menyusun prompt, tanpa akses untuk mengedit file.
**Local AI · Bonsai 27B** juga tersedia ketika server llama.cpp lokal aktif.

## GitHub

Login satu kali di Terminal:

```sh
gh auth login
```

Kemudian buka **Settings → GitHub**:

- **Import repository** melakukan clone `owner/repository` ke folder project Forge dan membukanya.
- **Backup now** melakukan add, commit, dan push.
- **Sync / Pull** mengambil commit GitHub untuk proyek yang sudah diimpor. Forge memeriksa perubahan lokal dan riwayat commit lebih dahulu; jika keduanya sudah berbeda, selesaikan konflik di Git sebelum sinkronisasi.
- Proyek tanpa Git dapat diekspor ke repository private baru.
- Forge tidak force-push. Backup ditolak bila remote memiliki commit lebih baru.

Di pemilih AI, Codex menampilkan **persentase kuota dalam jendela waktu** dan waktu reset jika App Server menyediakan datanya. Persentase ini bukan jumlah token tersisa pada akun ChatGPT. Gemini menampilkan **token konteks percakapan** (terpakai dan tersisa) jika CLI mengirim update ACP. Kuota akun Gemini tidak tersedia melalui update konteks tersebut; periksa lewat `/stats model` di Gemini CLI.

## MCP

Buka **Settings → MCP servers**, lalu isi nama, executable, arguments, dan scope. Forge menyimpan konfigurasi sebagai **untrusted**, meminta konfirmasi sebelum menjalankan server, melakukan handshake MCP lewat stdio, dan menampilkan jumlah tools/resources/prompts yang ditemukan.

Milestone ini menyediakan registry dan capability discovery. Pemanggilan tool MCP otomatis dari setiap provider belum diaktifkan; ini sengaja dipisahkan sampai policy per-tool dan approval UX selesai.

## Batas keamanan penting

- Ask dan Plan read-only. Build memakai batas workspace dan approval provider masing-masing.
- Terminal, preview, GitHub, restore, deploy, dan menjalankan MCP memerlukan konfirmasi.
- Monaco tidak membaca filesystem secara langsung; semua akses melalui local companion dan batas project root.
- File rahasia umum, symlink keluar root, file biner, dan file teks di atas 500 KB ditolak dari editor.
- Preview menjalankan kode proyek dengan akun lokal Anda. Hanya buka proyek yang dipercaya.
- Checkpoint internal mengabaikan `.git`, `.forge`, `node_modules`, build output, `.env*`, key, dan aturan `.gitignore`; ini bukan secret scanner.
- Belum ada auth Forge, multi-user, billing, akses cloud ke companion, atau plugin marketplace.

## Data lokal

Default data disimpan di `forge-web/.forge/`:

- `forge.sqlite` — project registry, chat, settings, deploy config.
- `projects/` — proyek yang dibuat Forge.
- `checkpoints/` — repository checkpoint terpisah dari Git proyek.
- `attachments/` — lampiran per proyek.

Pada instalasi Nobara melalui script, data berada di `~/.local/share/forge-web/data/` dan proyek baru di `~/Documents/ForgeProjects/`.

Override lokasi dengan `FORGE_DATA_DIR` dan `FORGE_PROJECTS_DIR` di `.env`.

## Konfigurasi environment

| Variable | Fungsi |
|---|---|
| `FORGE_CODEX_BIN` | Path Codex CLI |
| `FORGE_NODE_BIN` | Path Node.js |
| `FORGE_MODEL` | Model default Codex opsional |
| `FORGE_DATA_DIR` | Lokasi data lokal |
| `FORGE_BACKUP_DIR` | Lokasi snapshot lokal di luar source Forge |
| `FORGE_PROJECTS_DIR` | Folder induk proyek baru/import |
| `FORGE_PORT` | Port companion; kosong berarti acak |
| `FORGE_OLLAMA_BIN` | Path Ollama CLI |
| `FORGE_OLLAMA_URL` | API Ollama loopback |
| `FORGE_BONSAI_URL` | API llama.cpp Bonsai lokal; default `http://127.0.0.1:8080/v1` |

## Struktur repository

```text
src/                     React UI, Monaco, chat, workbench, settings
server/index.mjs         Local HTTP companion + streaming event bus
server/agents.mjs        Explicit provider/model router
server/api-providers.mjs Claude/OpenRouter adapter
server/github.mjs        Import/export/backup GitHub
server/mcp.mjs           MCP stdio registry + discovery
server/workspace.mjs     Project/file boundary + checkpoints
server/store.mjs         SQLite persistence
server/codex.mjs         Codex app-server adapter
server/gemini.mjs        Gemini ACP adapter
server/ollama.mjs        Local agent + approved tools
server/bonsai.mjs        llama.cpp adapter + approved local tools
templates/starter/       Starter app tanpa install tambahan
tests/                   Backend, security, provider, MCP, GitHub tests
```

## Validasi

```sh
npm run check
```

`check` menjalankan ESLint, seluruh test Node, TypeScript, dan production build. Monaco beserta language workers dibundel lokal; build tidak mengambil editor dari CDN.

## Troubleshooting

- **`Could not read package.json`** — jalankan command setelah `cd` ke folder `forge-web`.
- **Codex memakai model Ollama lama** — bersihkan override `openai_base_url`/model lokal di `~/.codex/config.toml`, lalu login Codex lagi bila perlu.
- **API key gagal disimpan** — macOS memakai Keychain; Linux memerlukan paket `libsecret` dan Secret Service desktop yang aktif serta terbuka.
- **GitHub belum terhubung** — jalankan `gh auth login`, lalu Refresh pada Settings.
- **Preview gagal** — pastikan proyek punya script `dev`; jalankan `npm install` dari Terminal panel bila dependency belum ada.
- **MCP timeout** — cek executable dan arguments, serta pastikan server memakai transport stdio JSON-RPC.
