#!/usr/bin/env bash
set -euo pipefail

source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
data_home="$HOME/Library/Application Support/Forge Web"
app_dir="$data_home/app"
data_dir="$data_home/data"
projects_dir="$HOME/Documents/ForgeProjects"
launcher="$HOME/.local/bin/forge-web"
finder_launcher="$HOME/Applications/Forge Web.command"

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf 'Installer ini khusus macOS.\n' >&2
  exit 1
fi
if ! command -v node >/dev/null || ! node -e 'const [major,minor]=process.versions.node.split(".").map(Number); process.exit(major>22 || major===22&&minor>=13 ? 0 : 1)' 2>/dev/null; then
  printf 'Node.js 22.13 atau lebih baru diperlukan. Instal Node.js LTS, lalu jalankan installer lagi.\n' >&2
  exit 1
fi
for program in npm git tar security open; do
  if ! command -v "$program" >/dev/null; then
    printf '%s belum tersedia. Pastikan Xcode Command Line Tools dan Node.js sudah terpasang.\n' "$program" >&2
    exit 1
  fi
done
if [[ ! -f "$source_dir/package-lock.json" || ! -f "$source_dir/server/index.mjs" ]]; then
  printf 'Jalankan installer dari folder source Forge yang lengkap.\n' >&2
  exit 1
fi

mkdir -p "$data_home" "$projects_dir" "$(dirname "$launcher")" "$(dirname "$finder_launcher")"

if [[ ! -e "$data_dir" ]]; then
  legacy_data=""
  for candidate in "$source_dir/.forge" "$HOME/Downloads/forge-web/.forge" "$HOME/forge-web/.forge"; do
    if [[ -f "$candidate/forge.sqlite" || -f "$candidate/projects.json" ]]; then
      legacy_data="$candidate"
      break
    fi
  done
  if [[ -n "$legacy_data" ]]; then
    migration_dir="$(mktemp -d "$data_home/.data-migration.XXXXXX")"
    tar -C "$legacy_data" -cf - . | tar -C "$migration_dir" -xf -
    node "$source_dir/scripts/migrate-macos-data.mjs" "$legacy_data" "$migration_dir" "$data_dir"
    mv "$migration_dir" "$data_dir"
    printf 'Data Forge lama dimigrasikan dari %s\n' "$legacy_data"
  else
    mkdir -p "$data_dir"
  fi
fi

printf 'Memasang Forge di %s\n' "$app_dir"
stage_dir="$(mktemp -d "$data_home/.app-update.XXXXXX")"
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
elif [[ -f "$source_dir/.env" && ! -L "$source_dir/.env" ]]; then
  cp -p -- "$source_dir/.env" "$stage_dir/.env"
fi
cd "$stage_dir"
npm ci
npm run build
cd "$source_dir"
if [[ -e "$app_dir" ]]; then
  previous_dir="$(mktemp -d "$data_home/.app-previous.XXXXXX")"
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
data_home="$HOME/Library/Application Support/Forge Web"
export FORGE_DATA_DIR="$data_home/data"
export FORGE_PROJECTS_DIR="$HOME/Documents/ForgeProjects"
exec node "$data_home/app/scripts/launch-macos.mjs"
LAUNCHER
chmod 755 "$launcher"

cat > "$finder_launcher" <<LAUNCHER
#!/usr/bin/env bash
exec "$launcher"
LAUNCHER
chmod 755 "$finder_launcher"

printf '\nForge terpasang. Jalankan dari Terminal dengan: %s\n' "$launcher"
printf 'Atau buka: %s\nData: %s\nProyek baru: %s\n' "$finder_launcher" "$data_dir" "$projects_dir"
