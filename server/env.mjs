/** Environment allowlist for child processes.
 *
 * Prevents .env secrets, API tokens, and deployment credentials from leaking to
 * spawned processes (preview, terminal, command agent, MCP, npm run build, etc.).
 * Only non-sensitive system/tool variables plus Forge's own FORGE_* variables
 * are forwarded. Credentials needed by a specific command (e.g. VERCEL_TOKEN)
 * must be added explicitly via the caller's `env` override, never by spreading
 * the whole parent environment.
 */

const ALLOWED_PREFIXES = [
  "FORGE_",
  "npm_",
  "npm_config_",
  "npm_lifecycle_",
  "npm_package_",
  "NODE_",
  "XDG_",
  "SSH_",
  "SSH_AGENT_",
  "TERM",
  "LC_",
  "LANG",
  "LOGNAME",
  "MAIL",
  "Apple_",
  "XPC_",
  "__CF",
  "SECURITYSESSIONID",
];

const ALLOWED_KEYS = new Set([
  // Shell / process basics
  "PATH",
  "HOME",
  "USER",
  "USERNAME",
  "SHELL",
  "ComSpec",
  "PWD",
  "OLDPWD",
  "SHLVL",
  // Temp / display
  "TMPDIR",
  "TMP",
  "TEMP",
  "DISPLAY",
  // Terminal / color
  "CI",
  "FORCE_COLOR",
  "NO_COLOR",
  "COLORTERM",
  "CLICOLOR",
  "CLICOLOR_FORCE",
  "MSYSTEM",
  "MSYS",
  "CYGWIN",
  // Common macOS / *nix
  "LOGNAME",
  "MAIL",
  "HOSTNAME",
  "LD_LIBRARY_PATH",
  "DYLD_LIBRARY_PATH",
  "DYLD_FALLBACK_LIBRARY_PATH",
  // Common tooling
  "GIT_ASKPASS",
  "GIT_SSH",
  "GIT_SSL_NO_VERIFY",
  "EDITOR",
  "VISUAL",
  "PAGER",
  "MANPAGER",
]);

const DENIED_PREFIXES = [
  "CLOUDFLARE_",
  "VERCEL_",
  "EXPO_",
  "SUPABASE_",
  "FIREBASE_",
  "OPENAI_",
  "ANTHROPIC_",
  "GEMINI_",
  "OLLAMA_",
  "MCP_",
  "BONSAI_",
  "AWS_",
  "AZURE_",
  "GOOGLE_",
  "GITHUB_",
  "GH_",
  "GIT_",
  "DOCKER_",
  "POSTGRES_",
  "DATABASE_",
  "REDIS_",
  "MONGO_",
  "SECRET",
  "TOKEN",
  "KEY",
  "PASSWORD",
  "CREDENTIAL",
  "FORGE_BRAVE_SEARCH_API_KEY",
];

export function isAllowedEnvKey(key) {
  if (typeof key !== "string" || !key) return false;
  if (ALLOWED_KEYS.has(key)) return true;
  if (ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix))) return true;
  if (DENIED_PREFIXES.some((prefix) => key.startsWith(prefix))) return false;
  // Deny anything that looks like a secret.
  const lower = key.toLowerCase();
  if (
    /(_(key|token|secret|password|credential|apikey|auth))$/.test(lower) ||
    /^(api_?key|api_?token|auth_?token|private_?key|client_?secret)/.test(
      lower,
    )
  )
    return false;
  return true;
}

/** Return a sanitized environment object from `source`. */
export function sanitizeEnv(source = process.env) {
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => isAllowedEnvKey(key)),
  );
}
