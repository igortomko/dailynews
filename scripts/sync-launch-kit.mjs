import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = resolve(root, "src/launch-kit");
const revision = "ea56d1d50be7727c1aff2c7a20b2f6f7b2273876";
const sourcePrefix = "launch-kit/components/analytics-dashboard/src/";
const inputs = { "profile.json": "src/lib/analytics/profile.json", "selection.json": "src/lib/analytics/selection.json" };
const args = process.argv.slice(2);
const checking = args.includes("--check");
const sourceIndex = args.indexOf("--source");
const source = sourceIndex < 0 ? undefined : args[sourceIndex + 1];
const sha256 = value => createHash("sha256").update(value).digest("hex");
const manifestPath = resolve(destination, "provenance.json");
const safePath = path => !path.startsWith("/") && !path.split("/").includes("..");

async function collectFiles(directory, prefix = "") {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const relative = `${prefix}${item.name}`;
    if (item.isDirectory()) files.push(...await collectFiles(resolve(directory, item.name), `${relative}/`));
    else files.push(relative);
  }
  return files.sort();
}

async function verifyManifest() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.source.commit !== revision) throw new Error("Unexpected Launch Kit revision");
  const expected = Object.keys(manifest.files).sort();
  const actual = (await collectFiles(destination)).filter(path => path !== "provenance.json");
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Vendored file list differs from provenance");
  for (const path of expected) {
    if (!safePath(path)) throw new Error("Unsafe manifest path");
    if (sha256(await readFile(resolve(destination, path))) !== manifest.files[path]) throw new Error(`Vendored source drift: ${path}`);
  }
  for (const [name, path] of Object.entries(inputs)) {
    if (sha256(await readFile(resolve(root, path))) !== manifest.hostInputs[name].sha256) throw new Error(`Host configuration changed; sync required: ${path}`);
  }
  console.log(`Verified ${expected.length} Launch Kit files at ${revision.slice(0, 7)}`);
}

if (!source) {
  if (!checking) throw new Error("Usage: npm run sync:launch-kit -- --source /path/to/agent-skills (or --check)");
  await verifyManifest();
} else {
  const git = (...args) => execFileSync("git", ["-C", resolve(source), ...args], { encoding: "utf8", maxBuffer: 10_000_000 });
  if (git("rev-parse", `${revision}^{commit}`).trim() !== revision) throw new Error("Source commit is unavailable");
  const paths = git("ls-tree", "-r", "--name-only", revision, sourcePrefix).trim().split("\n");
  const files = new Map();
  for (const path of paths) {
    const relative = path.slice(sourcePrefix.length);
    if (relative === "main.tsx" || !/\.(tsx?|css)$/.test(relative)) continue;
    files.set(relative, git("show", `${revision}:${path}`).replaceAll('"@/', '"@launch-kit/').replaceAll("'@/", "'@launch-kit/"));
  }
  for (const name of ["modules.json", "contract.json"]) files.set(name, git("show", `${revision}:launch-kit/common/analytics/${name}`));
  files.set("source-package.json", git("show", `${revision}:launch-kit/components/analytics-dashboard/package.json`));
  const hostInputs = {};
  for (const [name, path] of Object.entries(inputs)) {
    const content = await readFile(resolve(root, path), "utf8");
    files.set(name, content);
    hostInputs[name] = { path, sha256: sha256(content) };
  }
  const manifest = {
    schemaVersion: 1,
    source: { name: "Launch Kit analytics-dashboard", commit: revision, path: sourcePrefix },
    transformations: ['Import alias "@/" becomes "@launch-kit/"; Vite entry main.tsx is replaced by the Next host boundary.'],
    hostInputs,
    files: Object.fromEntries([...files.entries()].sort(([left], [right]) => left.localeCompare(right, "en")).map(([path, content]) => [path, sha256(content)])),
  };
  files.set("provenance.json", `${JSON.stringify(manifest, null, 2)}\n`);
  if (checking) {
    for (const [path, content] of files) if (await readFile(resolve(destination, path), "utf8") !== content) throw new Error(`Source mismatch: ${path}`);
    await verifyManifest();
  } else {
    await mkdir(destination, { recursive: true });
    const existing = await collectFiles(destination);
    const previous = existing.includes("provenance.json") ? JSON.parse(await readFile(manifestPath, "utf8")) : { files: {} };
    for (const path of existing.filter(path => path !== "provenance.json")) {
      if (!Object.hasOwn(previous.files, path)) throw new Error(`Unmanaged file in vendor directory: ${path}`);
      if (sha256(await readFile(resolve(destination, path))) !== previous.files[path]) throw new Error(`Uncommitted vendor edit: ${path}`);
    }
    for (const path of existing) if (!files.has(path)) await rm(resolve(destination, path));
    for (const [path, content] of files) {
      const target = resolve(destination, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    await verifyManifest();
  }
}
