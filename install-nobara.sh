#!/usr/bin/env bash
set -euo pipefail

source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
app_dir="$data_home/forge-web/app"
data_dir="$data_home/forge-web/data"
projects_dir="${XDG_DOCUMENTS_DIR:-$HOME/Documents}/ForgeProjects"
launcher="$HOME/.local/bin/forge-web"
desktop="$HOME/.local/share/applications/forge-web.desktop"

if ! command -v node >/dev/null || ! node -e 'const [major,minor]=process.versions.node.split(".").map(Number); process.exit(major>22 || major===22&&minor>=13 ? 0 : 1)' 2>/dev/null; then
  printf 'Node.js 22.13 atau lebih baru diperlukan. Jalankan: sudo dnf install nodejs npm git libsecret\n' >&2
  exit 1
fi
for program in npm git tar; do
  if ! command -v "$program" >/dev/null; then
    printf '%s belum tersedia. Jalankan: sudo dnf install nodejs npm git libsecret\n' "$program" >&2
    exit 1
  fi
done
if ! command -v secret-tool >/dev/null; then
  printf 'secret-tool belum tersedia. Jalankan: sudo dnf install libsecret\n' >&2
  exit 1
fi
if [[ ! -f "$source_dir/package-lock.json" || ! -f "$source_dir/server/index.mjs" ]]; then
  printf 'Jalankan installer dari folder source Forge yang lengkap.\n' >&2
  exit 1
fi

printf 'Memasang Forge di %s\n' "$app_dir"
mkdir -p "$(dirname "$app_dir")" "$data_dir" "$projects_dir" "$(dirname "$launcher")" "$(dirname "$desktop")"
stage_dir="$(mktemp -d "$(dirname "$app_dir")/.app-update.XXXXXX")"
previous_dir=""
cleanup() {
  if [[ -n "$previous_dir" && -d "$previous_dir" && ! -e "$app_dir" ]]; then
    mv "$previous_dir" "$app_dir"
  fi
  [[ ! -d "$stage_dir" ]] || rm -rf -- "$stage_dir"
}
trap cleanup EXIT
tar -C "$source_dir" --exclude='./node_modules' --exclude='./dist' --exclude='./.forge' \
  --exclude='./.git' --exclude='./.env' --exclude='./*.log' --exclude='./*.tsbuildinfo' -cf - . \
  | tar -C "$stage_dir" -xf -
if [[ -f "$app_dir/.env" && ! -L "$app_dir/.env" ]]; then
  cp -p -- "$app_dir/.env" "$stage_dir/.env"
fi
cd "$stage_dir"
npm ci
npm run build
cd "$source_dir"
if [[ -e "$app_dir" ]]; then
  previous_dir="$(mktemp -d "$(dirname "$app_dir")/.app-previous.XXXXXX")"
  rmdir "$previous_dir"
  mv "$app_dir" "$previous_dir"
fi
mv "$stage_dir" "$app_dir"
if [[ -n "$previous_dir" ]]; then
  rm -rf -- "$previous_dir"
  previous_dir=""
fi
trap - EXIT

cat > "$launcher" <<'LAUNCHER'
#!/usr/bin/env bash
set -euo pipefail
data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
export FORGE_DATA_DIR="$data_home/forge-web/data"
export FORGE_PROJECTS_DIR="${XDG_DOCUMENTS_DIR:-$HOME/Documents}/ForgeProjects"
exec node "$data_home/forge-web/app/scripts/launch-linux.mjs"
LAUNCHER
chmod 755 "$launcher"

cat > "$desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Forge Web
Comment=Local AI app builder
Exec=$launcher
Icon=applications-development
Terminal=true
Categories=Development;IDE;
DESKTOP
chmod 644 "$desktop"
if command -v update-desktop-database >/dev/null; then
  update-desktop-database "$(dirname "$desktop")" >/dev/null 2>&1 || true
fi
printf '\nForge terpasang. Buka “Forge Web” dari menu aplikasi, atau jalankan: %s\n' "$launcher"
printf 'Data: %s\nProyek baru: %s\n' "$data_dir" "$projects_dir"
printf 'Jika Ollama belum berjalan, jalankan: ollama serve\n'
printf 'Model terpasang bisa diperiksa dengan: ollama list\n'
