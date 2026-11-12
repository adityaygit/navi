import "server-only";
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

// Encryption for integration credentials (e.g. a private calendar feed URL).
// AES-256-GCM with a random 96-bit IV. The ciphertext is bound to its owner and
// connection through additional authenticated data, so a row copied onto
// another connection or user fails to decrypt. The key comes only from the
// server environment (NAVI_INTEGRATION_ENCRYPTION_KEY, 32 bytes, base64).
//
// Format: "v1.<iv b64url>.<tag b64url>.<ciphertext b64url>"

const VERSION = "v1";

export class IntegrationKeyMissingError extends Error {
  constructor() {
    super("Integration encryption key is not configured");
  }
}

function masterKey(): Buffer {
  const raw = process.env.NAVI_INTEGRATION_ENCRYPTION_KEY ?? "";
  if (!raw) throw new IntegrationKeyMissingError();
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("NAVI_INTEGRATION_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return key;
}

/** A separate key per purpose, derived from the master key. */
function derived(purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", masterKey(), Buffer.alloc(0), `navi:${purpose}`, 32));
}

export function integrationCryptoReady(): boolean {
  try {
    masterKey();
    return true;
  } catch {
    return false;
  }
}

const aad = (userId: string, connectionId: string) => Buffer.from(`navi-integration:${userId}:${connectionId}`);

export function sealSecret(plaintext: string, binding: { userId: string; connectionId: string }): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derived("secret-v1"), iv);
  cipher.setAAD(aad(binding.userId, binding.connectionId));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function openSecret(sealed: string, binding: { userId: string; connectionId: string }): string {
  const [version, iv, tag, ct] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || ct === undefined) throw new Error("Unrecognized secret format");
  const decipher = createDecipheriv("aes-256-gcm", derived("secret-v1"), Buffer.from(iv, "base64url"));
  decipher.setAAD(aad(binding.userId, binding.connectionId));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

/**
 * Keyed fingerprint of a credential: the same feed gives the same value for
 * one user, but it can't be reversed or checked against a guessed URL without
 * the server key.
 */
export function fingerprint(value: string, userId: string): string {
  return createHmac("sha256", derived("fingerprint-v1")).update(`${userId}\n${value}`).digest("base64url");
}
