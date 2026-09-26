import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const [legacyData, copiedData, installedData] = process.argv
  .slice(2)
  .map((item) => path.resolve(item));
if (!legacyData || !copiedData || !installedData)
  throw Error("Lokasi migrasi data Forge tidak lengkap.");

const legacyProjects = path.join(legacyData, "projects") + path.sep;
const installedProjects = path.join(installedData, "projects") + path.sep;
const dbPath = path.join(copiedData, "forge.sqlite");
try {
  const db = new DatabaseSync(dbPath);
  const rows = db.prepare("SELECT id, path FROM projects").all();
  const update = db.prepare("UPDATE projects SET path = ? WHERE id = ?");
  for (const row of rows) {
    if (typeof row.path === "string" && row.path.startsWith(legacyProjects))
      update.run(
        installedProjects + row.path.slice(legacyProjects.length),
        row.id,
      );
  }
  db.close();
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const jsonPath = path.join(copiedData, "projects.json");
try {
  const projects = JSON.parse(await fs.readFile(jsonPath, "utf8"));
  for (const project of Array.isArray(projects) ? projects : []) {
    if (
      typeof project.path === "string" &&
      project.path.startsWith(legacyProjects)
    )
      project.path =
        installedProjects + project.path.slice(legacyProjects.length);
  }
  await fs.writeFile(
    jsonPath,
    JSON.stringify(projects, null, 2) + "\n",
    "utf8",
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
