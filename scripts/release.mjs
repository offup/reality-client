// Publishes a new version of Reality Client.
//
//   npm run release -- 0.2.0 "What changed"
//
// 1. Sets the version in package.json, tauri.conf.json and Cargo.toml, commits, tags and pushes (private source repo)
// 2. Builds the installer and signs the update with the key in ~/.tauri/reality-client.key
// 3. Creates the release in the public repo with the installer and latest.json (read by the launcher's updater)

import { execFileSync, execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const RELEASES_REPO = "offup/reality-client-releases";
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

// 2. Build and sign
run("npm run tauri build", {
  TAURI_SIGNING_PRIVATE_KEY: readFileSync(KEY_FILE, "utf8"),
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "",
});
const bundle = "src-tauri/target/release/bundle/nsis";
const built = join(bundle, `Reality Client_${version}_x64-setup.exe`);
const signature = readFileSync(`${built}.sig`, "utf8").trim();

// 3. Release files: installer without spaces in the name, plus the update description
mkdirSync("release-out", { recursive: true });
const setupName = `Reality-Client_${version}_x64-setup.exe`;
const setup = join("release-out", setupName);
copyFileSync(built, setup);
const url = `https://github.com/${RELEASES_REPO}/releases/download/${tag}/${setupName}`;
const platform = { signature, url };
const latest = join("release-out", "latest.json");
writeFileSync(
  latest,
  JSON.stringify(
    {
      version,
      notes,
      pub_date: new Date().toISOString(),
      platforms: { "windows-x86_64": platform, "windows-x86_64-nsis": platform },
    },
    null,
    2,
  ),
);

const body = `${notes}\n\n**Download:** ${setupName} below, then run it.\nAlready installed? The launcher shows the update at the top left, one click installs it.`;
execFileSync(GH, ["release", "create", tag, setup, latest, "--repo", RELEASES_REPO, "--title", `Reality Client ${tag}`, "--notes", body], {
  stdio: "inherit",
});
console.log(`\n${tag} is live: https://github.com/${RELEASES_REPO}/releases/tag/${tag}`);
