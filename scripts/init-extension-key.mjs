import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const keyPath = resolve(
  projectRoot,
  process.env.EXTENSION_SIGNING_KEY_PATH ??
    ".local/douyin-archive-companion.pem",
);

if (existsSync(keyPath)) {
  console.log(`Extension signing key already exists: ${keyPath}`);
  process.exit(0);
}

mkdirSync(dirname(keyPath), { recursive: true });

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 4096 });
writeFileSync(
  keyPath,
  privateKey.export({ format: "pem", type: "pkcs8" }),
  { mode: 0o600 },
);

console.log(`Created extension signing key: ${keyPath}`);
console.log("Back up this file securely. It keeps the Chrome extension ID stable.");
