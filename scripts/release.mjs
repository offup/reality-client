// Publishes a new version of Reality Client for Windows and macOS.
//
//   npm run release -- 0.2.0 "What changed"
//
// 1. Sets the version in package.json, tauri.conf.json and Cargo.toml, commits, tags and pushes (private source repo)
// 2. Builds the Windows installer here; the tag starts the macOS build on GitHub (.github/workflows/macos.yml)
// 3. Waits for the Mac build, then creates one release in the public repo with both downloads and latest.json
//    (read by the launcher's updater on Windows and macOS). Updates are signed with ~/.tauri/reality-client.key

import { execFileSync, execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const RELEASES_REPO = "offup/reality-client-releases";
const SOURCE_REPO = "offup/reality-client";
const KEY_FILE = join(homedir(), ".tauri", "reality-client.key");
const GH = existsSync("C:\\Program Files\\GitHub CLI\\gh.exe") ? "C:\\Program Files\\GitHub CLI\\gh.exe" : "gh";

const version = process.argv[2];
const notes = process.argv[3] ?? "Bug fixes and improvements.";
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error('Usage: npm run release -- <major.minor.patch> ["notes"]');
  process.exit(1);
}
if (!existsSync(KEY_FILE)) {
  console.error(`Signing key missing: ${KEY_FILE}`);
  process.exit(1);
}

const run = (cmd, env) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });
const quiet = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();
const gh = (...args) => execFileSync(GH, args, { encoding: "utf8" }).trim();
const ghLive = (...args) => execFileSync(GH, args, { stdio: "inherit" });
const pause = (seconds) => execSync(process.platform === "win32" ? `ping -n ${seconds + 1} 127.0.0.1 >nul` : `sleep ${seconds}`);
const tag = `v${version}`;

// 1. Version everywhere, commit, tag, push
const json = (file, change) => {
  const data = JSON.parse(readFileSync(file, "utf8"));
  change(data);
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
};
json("package.json", (p) => (p.version = version));
json("src-tauri/tauri.conf.json", (c) => (c.version = version));
writeFileSync(
  "src-tauri/Cargo.toml",
  readFileSync("src-tauri/Cargo.toml", "utf8").replace(/^version = ".*"$/m, `version = "${version}"`),
);
run("npm install --package-lock-only --ignore-scripts --silent");
run("cargo update --manifest-path src-tauri/Cargo.toml --package reality-client --quiet");
run("git add -A");
if (quiet("git status --porcelain")) run(`git commit -m "Release ${tag}"`);
if (!quiet(`git tag --list ${tag}`)) run(`git tag ${tag}`);
run("git push");
run(`git push origin ${tag}`);

// 2. Windows: build and sign here
run("npm run tauri build -- --bundles nsis", {
  TAURI_SIGNING_PRIVATE_KEY: readFileSync(KEY_FILE, "utf8"),
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "",
});
const built = join("src-tauri/target/release/bundle/nsis", `Reality Client_${version}_x64-setup.exe`);
const windowsSignature = readFileSync(`${built}.sig`, "utf8").trim();

// 3. macOS: wait for the GitHub build of this tag and download it
console.log("\nWaiting for the macOS build on GitHub…");
let runId = "";
for (let i = 0; i < 60 && !runId; i++) {
  runId = gh("run", "list", "--repo", SOURCE_REPO, "--workflow", "macos.yml", "--branch", tag, "--limit", "1", "--json", "databaseId", "--jq", ".[0].databaseId // empty");
  if (!runId) pause(5);
}
if (!runId) throw new Error(`No macOS build started for ${tag}`);
ghLive("run", "watch", runId, "--repo", SOURCE_REPO, "--exit-status", "--interval", "20");
const macDir = join("release-out", `macos-${version}`);
rmSync(macDir, { recursive: true, force: true });
ghLive("run", "download", runId, "--repo", SOURCE_REPO, "--name", "macos", "--dir", macDir);

const findFile = (dir, test) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(path, test);
      if (found) return found;
    } else if (test(entry.name)) {
      return path;
    }
  }
  return null;
};
const macDmg = findFile(macDir, (n) => n.endsWith(".dmg"));
const macTar = findFile(macDir, (n) => n.endsWith(".app.tar.gz"));
const macSig = findFile(macDir, (n) => n.endsWith(".app.tar.gz.sig"));
if (!macDmg || !macTar || !macSig) throw new Error("The macOS build is missing files");

// 4. Release files without spaces in the names, plus the update description for both systems
mkdirSync("release-out", { recursive: true });
const setupName = `Reality-Client_${version}_x64-setup.exe`;
const dmgName = `Reality-Client_${version}_macOS.dmg`;
const tarName = `Reality-Client_${version}_macOS.app.tar.gz`;
const setup = join("release-out", setupName);
const dmg = join("release-out", dmgName);
const tar = join("release-out", tarName);
copyFileSync(built, setup);
copyFileSync(macDmg, dmg);
copyFileSync(macTar, tar);

const download = (name) => `https://github.com/${RELEASES_REPO}/releases/download/${tag}/${name}`;
const windows = { signature: windowsSignature, url: download(setupName) };
const mac = { signature: readFileSync(macSig, "utf8").trim(), url: download(tarName) };
const latest = join("release-out", "latest.json");
writeFileSync(
  latest,
  JSON.stringify(
    {
      version,
      notes,
      pub_date: new Date().toISOString(),
      platforms: {
        "windows-x86_64": windows,
        "windows-x86_64-nsis": windows,
        "darwin-aarch64": mac,
        "darwin-aarch64-app": mac,
      },
    },
    null,
    2,
  ),
);

const body = [
  notes,
  "",
  `**Windows:** ${setupName}`,
  `**macOS:** ${dmgName} (Apple silicon, M1 and newer)`,
  "",
  "Already installed? The launcher shows the update at the top left, one click installs it.",
].join("\n");
ghLive("release", "create", tag, setup, dmg, tar, latest, "--repo", RELEASES_REPO, "--title", `Reality Client ${tag}`, "--notes", body);
console.log(`\n${tag} is live: https://github.com/${RELEASES_REPO}/releases/tag/${tag}`);
