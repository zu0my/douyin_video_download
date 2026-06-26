import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const crx3 = require("crx3");

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = join(projectRoot, "chrome-extension");
const manifestPath = join(extensionRoot, "manifest.json");
const keyPath = resolve(
  projectRoot,
  process.env.EXTENSION_SIGNING_KEY_PATH ??
    ".local/douyin-archive-companion.pem",
);
const outputDirectory = resolve(
  projectRoot,
  process.env.EXTENSION_OUTPUT_DIR ??
    "src-tauri/target/release/bundle/chrome-extension",
);
const runtimeFiles = [
  "manifest.json",
  "service-worker.js",
  "content.js",
  "popup.js",
  "popup.html",
  "popup.css",
  "icon.png",
];

if (!existsSync(keyPath)) {
  throw new Error(
    `Extension signing key is missing: ${keyPath}\nRun \"npm run extension:init-key\" once before packaging.`,
  );
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (typeof manifest.version !== "string" || manifest.version.length === 0) {
  throw new Error("chrome-extension/manifest.json must contain a version.");
}

for (const file of runtimeFiles) {
  if (!existsSync(join(extensionRoot, file))) {
    throw new Error(`Required extension runtime file is missing: ${file}`);
  }
}

const artifactBaseName = `DouyinArchiveCompanion-${manifest.version}`;
const crxPath = join(outputDirectory, `${artifactBaseName}.crx`);
const zipPath = join(outputDirectory, `${artifactBaseName}.zip`);
const stagingDirectory = await mkdtemp(join(tmpdir(), "douyin-archive-extension-"));

try {
  await Promise.all(
    runtimeFiles.map(async (file) => {
      const destination = join(stagingDirectory, file);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(join(extensionRoot, file), destination);
    }),
  );

  await mkdir(outputDirectory, { recursive: true });
  await crx3([join(stagingDirectory, "manifest.json")], {
    crxPath,
    keyPath,
    zipPath,
  });

  await validateCrx3(crxPath);
  await validateZip(zipPath);
} finally {
  await rm(stagingDirectory, { force: true, recursive: true });
}

console.log(`Created CRX: ${crxPath}`);
console.log(`Created ZIP: ${zipPath}`);

async function validateCrx3(path) {
  const header = await readFile(path);
  if (
    header.length < 12 ||
    header.subarray(0, 4).toString("ascii") !== "Cr24" ||
    header.readUInt32LE(4) !== 3
  ) {
    throw new Error(`Generated artifact is not a valid CRX3 file: ${path}`);
  }
}

async function validateZip(path) {
  const archive = await readFile(path);
  const entries = readZipCentralDirectory(archive);

  if (!entries.includes("manifest.json")) {
    throw new Error(`Generated ZIP does not contain manifest.json: ${path}`);
  }

  if (entries.some((entry) => basename(entry).toLowerCase().endsWith(".pem"))) {
    throw new Error(`Generated ZIP must not contain a private key: ${path}`);
  }
}

function readZipCentralDirectory(archive) {
  const endOfCentralDirectory = findEndOfCentralDirectory(archive);
  const entryCount = archive.readUInt16LE(endOfCentralDirectory + 10);
  let cursor = archive.readUInt32LE(endOfCentralDirectory + 16);
  const entries = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (archive.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("Generated ZIP has an invalid central directory.");
    }

    const fileNameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const fileNameStart = cursor + 46;
    const fileNameEnd = fileNameStart + fileNameLength;

    entries.push(archive.subarray(fileNameStart, fileNameEnd).toString("utf8"));
    cursor = fileNameEnd + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(archive) {
  const minimumLength = 22;
  const maximumCommentLength = 0xffff;
  const start = Math.max(0, archive.length - minimumLength - maximumCommentLength);

  for (let index = archive.length - minimumLength; index >= start; index -= 1) {
    if (archive.readUInt32LE(index) === 0x06054b50) {
      return index;
    }
  }

  throw new Error("Generated file is not a readable ZIP archive.");
}
