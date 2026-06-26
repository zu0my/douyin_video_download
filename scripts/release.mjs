import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const allowedBumps = new Set(["patch", "minor", "major"]);
const bump = process.argv[2];

const files = {
  packageJson: "package.json",
  cargoToml: "src-tauri/Cargo.toml",
  cargoLock: "src-tauri/Cargo.lock",
  tauriConfig: "src-tauri/tauri.conf.json",
  extensionManifest: "chrome-extension/manifest.json",
};

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

function usage() {
  return "Usage: pnpm release <patch|minor|major>";
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: options.capture ? "pipe" : "inherit",
  });

  if (result.error) {
    fail(`failed to run ${command}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const details = options.capture
      ? `${result.stderr || result.stdout || ""}`.trim()
      : "";
    fail(
      details
        ? `${command} ${args.join(" ")} failed:\n${details}`
        : `${command} ${args.join(" ")} failed`,
    );
  }

  return options.capture ? result.stdout.trim() : "";
}

function parseVersion(version, source) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    fail(`${source} has invalid version "${version}". Expected X.Y.Z.`);
  }

  return match.slice(1).map(Number);
}

function bumpVersion(version, bumpType) {
  const [major, minor, patch] = parseVersion(version, files.packageJson);

  if (bumpType === "major") {
    return `${major + 1}.0.0`;
  }

  if (bumpType === "minor") {
    return `${major}.${minor + 1}.0`;
  }

  return `${major}.${minor}.${patch + 1}`;
}

function assertCleanWorktree() {
  const status = run("git", ["status", "--porcelain"], { capture: true });
  if (status) {
    fail(`working tree is not clean. Commit or stash changes before releasing.\n${status}`);
  }
}

function assertTagAvailable(tagName) {
  const result = spawnSync("git", ["rev-parse", "-q", "--verify", `refs/tags/${tagName}`], {
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: "pipe",
  });

  if (result.error) {
    fail(`failed to check tag ${tagName}: ${result.error.message}`);
  }

  if (result.status === 0) {
    fail(`tag ${tagName} already exists`);
  }

  if (result.status !== 1) {
    fail(`git tag check failed for ${tagName}: ${(result.stderr || "").trim()}`);
  }
}

function updateJsonVersion(text, version) {
  const data = JSON.parse(text);
  data.version = version;
  return `${JSON.stringify(data, null, 2)}\n`;
}

function updateCargoPackageVersion(text, version, path) {
  const packageHeader = text.match(/^\[package\]\r?\n/);
  if (!packageHeader) {
    fail(`${path} is missing a [package] section`);
  }

  const next = text.replace(
    /^(\[package\]\r?\n(?:[^\[]*\r?\n)*?version\s*=\s*)"[^"]+"/m,
    `$1"${version}"`,
  );

  if (next === text) {
    fail(`${path} is missing package version`);
  }

  return next;
}

function updateCargoLockVersion(text, version) {
  const next = text.replace(
    /(name = "douyin-video-download"\r?\nversion = )"[^"]+"/,
    `$1"${version}"`,
  );

  if (next === text) {
    fail(`${files.cargoLock} is missing douyin-video-download package version`);
  }

  return next;
}

function reportVersionDrift(versions, sourceVersion) {
  const drifted = Object.entries(versions).filter(([, version]) => version !== sourceVersion);
  if (drifted.length === 0) {
    return;
  }

  console.warn("release: existing versions are not aligned; package.json remains the source of truth:");
  for (const [source, version] of drifted) {
    console.warn(`  ${source}: ${version}`);
  }
}

async function main() {
  if (!allowedBumps.has(bump)) {
    fail(`${usage()}\nOnly patch, minor, or major are supported.`);
  }

  assertCleanWorktree();

  const [
    packageJsonText,
    cargoTomlText,
    cargoLockText,
    tauriConfigText,
    extensionManifestText,
  ] = await Promise.all([
    readFile(files.packageJson, "utf8"),
    readFile(files.cargoToml, "utf8"),
    readFile(files.cargoLock, "utf8"),
    readFile(files.tauriConfig, "utf8"),
    readFile(files.extensionManifest, "utf8"),
  ]);

  const packageJson = JSON.parse(packageJsonText);
  const tauriConfig = JSON.parse(tauriConfigText);
  const extensionManifest = JSON.parse(extensionManifestText);

  const currentVersion = packageJson.version;
  parseVersion(currentVersion, files.packageJson);

  const cargoTomlVersion = cargoTomlText.match(/^\[package\]\r?\n(?:[^\[]*\r?\n)*?version\s*=\s*"([^"]+)"/m)?.[1];
  const cargoLockVersion = cargoLockText.match(/name = "douyin-video-download"\r?\nversion = "([^"]+)"/)?.[1];

  if (!cargoTomlVersion) {
    fail(`${files.cargoToml} is missing package version`);
  }
  if (!cargoLockVersion) {
    fail(`${files.cargoLock} is missing douyin-video-download package version`);
  }

  reportVersionDrift(
    {
      [files.cargoToml]: cargoTomlVersion,
      [files.cargoLock]: cargoLockVersion,
      [files.tauriConfig]: tauriConfig.version,
      [files.extensionManifest]: extensionManifest.version,
    },
    currentVersion,
  );

  const nextVersion = bumpVersion(currentVersion, bump);
  const tagName = `v${nextVersion}`;
  assertTagAvailable(tagName);

  await Promise.all([
    writeFile(files.packageJson, updateJsonVersion(packageJsonText, nextVersion)),
    writeFile(files.cargoToml, updateCargoPackageVersion(cargoTomlText, nextVersion, files.cargoToml)),
    writeFile(files.cargoLock, updateCargoLockVersion(cargoLockText, nextVersion)),
    writeFile(files.tauriConfig, updateJsonVersion(tauriConfigText, nextVersion)),
    writeFile(files.extensionManifest, updateJsonVersion(extensionManifestText, nextVersion)),
  ]);

  console.log(`release: bumped ${currentVersion} -> ${nextVersion}`);

  run("pnpm", ["run", "verify"]);
  run("git", [
    "add",
    files.packageJson,
    files.cargoToml,
    files.cargoLock,
    files.tauriConfig,
    files.extensionManifest,
  ]);
  run("git", ["commit", "-m", `chore: release ${tagName}`]);
  run("git", ["tag", tagName]);

  console.log(`release: created commit and tag ${tagName}`);
  console.log(`release: push with git push origin main --tags`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
