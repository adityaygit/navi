import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Application-level encryption for secrets Navi stores (OAuth tokens) and for
// short-lived signed state (the OAuth state cookie). AES-256-GCM with a random
// 96-bit IV; the auth tag makes any tampering fail to decrypt. `context` is
// bound in as associated data, so a ciphertext copied to another row or
// purpose (e.g. another connection's token column) won't decrypt there.
//
// Key: NAVI_TOKEN_ENCRYPTION_KEY, 32 random bytes as 64 hex chars or base64
// (generate with `openssl rand -base64 32`). Server-only; never sent to the browser.

const VERSION = "v1";

export class EncryptionUnavailableError extends Error {}

function parseKey(raw: string): Buffer | null {
  const value = raw.trim();
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, "hex");
  try {
    const b = Buffer.from(value, "base64");
    return b.length === 32 ? b : null;
  } catch {
    return null;
  }
}

function key(): Buffer {
  const raw = process.env.NAVI_TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new EncryptionUnavailableError("NAVI_TOKEN_ENCRYPTION_KEY is not set");
  const k = parseKey(raw);
  if (!k) throw new EncryptionUnavailableError("NAVI_TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex characters or base64)");
  return k;
}

/** Is a usable encryption key configured? */
export function encryptionConfigured(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plain: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

/** Throws if the value was tampered with, encrypted for another context, or under another key. */
export function decryptSecret(sealed: string, context: string): string {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || body === undefined) throw new Error("Unrecognised encrypted value");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}
