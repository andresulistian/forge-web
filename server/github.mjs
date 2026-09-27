import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { securityAudit } from "./security.mjs";

const defaultExec = promisify(execFile);
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export class GitHubManager {
  constructor(projectsDir, emit, { exec = defaultExec } = {}) {
    this.projectsDir = projectsDir;
    this.emit = emit;
    this.exec = exec;
  }

  async command(file, args, options = {}) {
    const result = await this.exec(file, args, {
      maxBuffer: 8 * 1024 * 1024,
      timeout: 120000,
      ...options,
    });
    return {
      stdout: result.stdout?.trim() || "",
      stderr: result.stderr?.trim() || "",
    };
  }

  async auth() {
    try {
      const { stdout, stderr } = await this.command("gh", ["auth", "status"]);
      return {
        connected: true,
        message: stdout || stderr || "GitHub CLI tersambung",
      };
    } catch (error) {
      return {
        connected: false,
        message:
          "Jalankan gh auth login di Terminal untuk menghubungkan GitHub.",
        error: String(error.stderr || error.message).slice(0, 500),
      };
    }
  }

  async projectStatus(project) {
    const auth = await this.auth();
    if (!project) return { auth, repository: null };
    try {
      const [{ stdout: branch }, { stdout: remote }, { stdout: changes }] =
        await Promise.all([
          this.command("git", ["branch", "--show-current"], {
            cwd: project.path,
          }),
          this.command("git", ["remote", "get-url", "origin"], {
            cwd: project.path,
          }),
          this.command("git", ["status", "--porcelain"], { cwd: project.path }),
        ]);
      return {
        auth,
        repository: {
          branch: branch || "HEAD",
          remote,
          dirty: Boolean(changes),
          changedFiles: changes ? changes.split("\n").length : 0,
        },
      };
    } catch {
      return { auth, repository: null };
    }
  }

  async clone(repository, branch = "") {
    if (!REPO.test(repository))
      throw Error("Repository harus memakai format owner/nama-repository.");
    const name = repository.split("/")[1];
    const destination = path.join(this.projectsDir, name);
    try {
      await fs.access(destination);
      throw Error(`Folder tujuan sudah ada: ${destination}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const args = ["repo", "clone", repository, destination];
    if (branch) args.push("--", "--branch", branch, "--single-branch");
    this.emit("github", { action: "clone", status: "started", repository });
    try {
      await this.command("gh", args, { cwd: this.projectsDir });
      this.emit("github", { action: "clone", status: "completed", repository });
      return destination;
    } catch (error) {
      this.emit("github", {
        action: "clone",
        status: "failed",
        repository,
        error: error.message,
      });
      throw error;
    }
  }

  async pull(project) {
    const cwd = project.path;
    const { stdout: remote } = await this.command(
      "git",
      ["remote", "get-url", "origin"],
      { cwd },
    );
    if (!remote) throw Error("Proyek belum mempunyai Git remote origin.");
    const { stdout: branch } = await this.command(
      "git",
      ["branch", "--show-current"],
      { cwd },
    );
    if (!branch) throw Error("Pilih branch sebelum Sync / Pull.");
    const { stdout: dirty } = await this.command(
      "git",
      ["status", "--porcelain"],
      { cwd },
    );
    if (dirty)
      throw Error(
        "Ada perubahan lokal yang belum di-commit. Simpan dan Backup Now sebelum Sync / Pull.",
      );
    this.emit("github", {
      action: "pull",
      status: "started",
      projectId: project.id,
    });
    try {
      await this.command("git", ["fetch", "origin"], { cwd });
      await this.command(
        "git",
        ["rev-parse", "--verify", `refs/remotes/origin/${branch}`],
        { cwd },
      );
      const { stdout: behind } = await this.command(
        "git",
        ["rev-list", "--count", `HEAD..origin/${branch}`],
        { cwd },
      );
      const { stdout: ahead } = await this.command(
        "git",
        ["rev-list", "--count", `origin/${branch}..HEAD`],
        { cwd },
      );
      if (Number(behind) && Number(ahead))
        throw Error(
          "Branch lokal dan GitHub berbeda. Selesaikan perbedaan commit sebelum Sync / Pull.",
        );
      if (Number(behind))
        await this.command("git", ["merge", "--ff-only", `origin/${branch}`], {
          cwd,
        });
      const result = {
        updated: Number(behind) > 0,
        commits: Number(behind),
        branch,
      };
      this.emit("github", {
        action: "pull",
        status: "completed",
        projectId: project.id,
        ...result,
      });
      return result;
    } catch (error) {
      this.emit("github", {
        action: "pull",
        status: "failed",
        projectId: project.id,
        error: error.message,
      });
      throw error;
    }
  }

  async backup(project, input) {
    const message = String(input.message || "Backup from Forge")
      .trim()
      .slice(0, 160);
    if (!message) throw Error("Pesan commit wajib diisi.");
    const gitDir = path.join(project.path, ".git");
    let hasGit = true;
    try {
      await fs.access(gitDir);
    } catch {
      hasGit = false;
    }
    this.emit("github", {
      action: "backup",
      status: "started",
      projectId: project.id,
    });
    try {
      if (!hasGit) {
        const repository = String(input.repository || "").trim();
        if (!REPO.test(repository))
          throw Error("Masukkan repository baru dalam format owner/nama.");
        await this.command("git", ["init", "-b", "main"], {
          cwd: project.path,
        });
        await this.command("git", ["config", "user.name", "Forge User"], {
          cwd: project.path,
        });
        await this.command("git", ["config", "user.email", "forge@localhost"], {
          cwd: project.path,
        });
        const audit = await securityAudit(project, { artifact: false, uploadsSource: true });
        if (!audit.passed) throw Error(this.formatAuditError(audit));
        await this.command("git", ["add", "-A"], { cwd: project.path });
        await this.command("git", ["commit", "--allow-empty", "-m", message], {
          cwd: project.path,
        });
        await this.command(
          "gh",
          [
            "repo",
            "create",
            repository,
            "--private",
            "--source",
            project.path,
            "--remote",
            "origin",
            "--push",
          ],
          { cwd: project.path },
        );
      } else {
        await this.command("git", ["fetch", "origin"], { cwd: project.path });
        const { stdout: branch } = await this.command(
          "git",
          ["branch", "--show-current"],
          {
            cwd: project.path,
          },
        );
        const { stdout: behind } = await this.command(
          "git",
          ["rev-list", "--count", `HEAD..origin/${branch}`],
          { cwd: project.path },
        ).catch(() => ({ stdout: "0" }));
        if (Number(behind) > 0)
          throw Error(
            "Remote memiliki perubahan baru. Jalankan pull dan selesaikan conflict sebelum Backup Now.",
          );
        const audit = await securityAudit(project, { artifact: false, uploadsSource: true });
        if (!audit.passed) throw Error(this.formatAuditError(audit));
        await this.command("git", ["add", "-A"], { cwd: project.path });
        const { stdout: changes } = await this.command(
          "git",
          ["status", "--porcelain"],
          {
            cwd: project.path,
          },
        );
        if (changes)
          await this.command("git", ["commit", "-m", message], {
            cwd: project.path,
          });
        await this.command("git", ["push", "origin", branch], {
          cwd: project.path,
        });
      }
      const status = await this.projectStatus(project);
      this.emit("github", {
        action: "backup",
        status: "completed",
        projectId: project.id,
      });
      return status;
    } catch (error) {
      this.emit("github", {
        action: "backup",
        status: "failed",
        projectId: project.id,
        error: error.message,
      });
      throw error;
    }
  }

  formatAuditError(audit) {
    const count = audit.findings.filter((f) => f.blocking).length;
    const files = audit.findings
      .filter((f) => f.blocking)
      .map((f) => f.file)
      .slice(0, 5);
    return `Security Gate memblokir backup: ${count} temuan. ${files.join(", ")}`;
  }
}
