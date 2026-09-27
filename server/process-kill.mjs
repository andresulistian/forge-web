/**
 * Kill a spawned child process (and its process group on Unix) gracefully,
 * then force-kill it after `timeoutMs` if it is still alive.
 * @param {import("node:child_process").ChildProcess} child
 * @param {number} [timeoutMs]
 */
export function killProcess(child, timeoutMs = 2000) {
  if (!child) return;
  const pid = child.pid;
  if (pid == null) return;

  try {
    if (process.platform === "win32") {
      child.kill("SIGTERM");
    } else {
      // Kill the whole process group so grandchildren are also terminated.
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }
  } catch {
    /* already exited */
  }

  if (timeoutMs <= 0) return;

  const timer = setTimeout(() => {
    try {
      if (process.platform === "win32") {
        child.kill("SIGKILL");
      } else {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    } catch {
      /* already exited */
    }
  }, timeoutMs);
  timer.unref?.();
}
