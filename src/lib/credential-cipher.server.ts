// Encrypts the admin-issued credentials kept in `admin_credentials` so they are
// not stored in plain text at rest, while still allowing admins to view/copy
// them (the existing workflow). AES-256-GCM with a key from CREDENTIAL_ENC_KEY
// (base64-encoded 32 bytes).
//
// Backward/forward compatible:
//  - If no key is configured, values are stored as-is (legacy behaviour) so
//    nothing breaks; set the key in production to activate encryption.
//  - decryptSecret() returns legacy plaintext rows unchanged (no "enc:v1:"
//    prefix), so existing rows keep working and get encrypted on next write.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";

function getKey(): Buffer | null {
  const raw = process.env.CREDENTIAL_ENC_KEY;
  if (!raw) return null;
  try {
    const b = Buffer.from(raw, "base64");
    return b.length === 32 ? b : null;
  } catch {
    return null;
  }
}

export function encryptSecret(plain: string): string {
  const key = getKey();
  if (!key) return plain; // no key -> behave exactly as before (plaintext)
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext row
  const key = getKey();
  if (!key) return null; // encrypted but no key available to decrypt
  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
