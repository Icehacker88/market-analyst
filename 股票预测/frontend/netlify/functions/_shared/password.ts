import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
// Fixed-length comparison without an early return on the first differing byte.
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  let difference = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ (b[i] ?? 0);
  return difference === 0;
}

export const PASSWORD_ITERATIONS = 600000;
export type PasswordCredential = {
  scheme: "pbkdf2-sha256"; version: 1; iterations: number; dklen: 32;
  salt: string; hash: string;
};
const encoder = new TextEncoder();
const invalid = { valid: false, needs_upgrade: false };
const MAX_LEGACY_ITERATIONS = 2_000_000;
function base64(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)); }
function decode(value: unknown, length: number): Uint8Array | null {
  if (typeof value !== "string" || value.length > 200) return null;
  try {
    const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
    return bytes.length === length && base64(bytes) === value ? bytes : null;
  } catch { return null; }
}
function derive(password: string, salt: Uint8Array, iterations: number): Uint8Array {
  const bytes = encoder.encode(password);
  try { return pbkdf2(sha256, bytes, salt, { c: iterations, dkLen: 32 }); }
  finally { bytes.fill(0); }
}
export function createPasswordCredential(password: string, iterations = PASSWORD_ITERATIONS): PasswordCredential {
  if (!Number.isSafeInteger(iterations) || iterations < PASSWORD_ITERATIONS || iterations > MAX_LEGACY_ITERATIONS) throw new Error("Unsupported password policy");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = derive(password, salt, iterations);
  try { return { scheme: "pbkdf2-sha256", version: 1, iterations, dklen: 32, salt: base64(salt), hash: base64(hash) }; }
  finally { hash.fill(0); }
}
// Used for unknown/malformed accounts too; never log or return a credential.
export function dummyPasswordWork(password: string): void {
  derive(password, new Uint8Array(16), PASSWORD_ITERATIONS).fill(0);
}
export async function verifyPassword(password: string, record: unknown): Promise<{ valid: boolean; needs_upgrade: boolean; upgrade_iterations?: number }> {
  if (!password || !record || typeof record !== "object") { dummyPasswordWork(password); return invalid; }
  const item = record as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(item, "password_credential")) {
    const c = item.password_credential as Partial<PasswordCredential> | null;
    const salt = decode(c?.salt, 16), hash = decode(c?.hash, 32);
    // Explicit, versioned policy. Invalid new records NEVER fall back to legacy fields.
    if (!c || c.scheme !== "pbkdf2-sha256" || c.version !== 1 || (typeof c.iterations !== "number" || !Number.isSafeInteger(c.iterations) || c.iterations < PASSWORD_ITERATIONS || c.iterations > MAX_LEGACY_ITERATIONS) || c.dklen !== 32 || !salt || !hash) {
      dummyPasswordWork(password); return invalid;
    }
    const candidate = derive(password, salt, c.iterations);
    try { return { valid: equalBytes(candidate, hash), needs_upgrade: false }; }
    finally { candidate.fill(0); }
  }
  if (typeof item.password_hash !== "string" || typeof item.salt !== "string" || !item.salt || item.salt.length > 256) {
    dummyPasswordWork(password); return invalid;
  }
  const match = /^pbkdf2_sha256\$([1-9][0-9]{0,6})\$([^$]{1,256})\$([A-Za-z0-9+/]{43}=)$/.exec(item.password_hash);
  if (match) {
    const iterations = Number(match[1]), hash = decode(match[3], 32);
    if (!hash || iterations > MAX_LEGACY_ITERATIONS || match[2] !== item.salt) { dummyPasswordWork(password); return invalid; }
    const candidate = derive(password, encoder.encode(match[2]), iterations);
    try { const valid = equalBytes(candidate, hash); return { valid, needs_upgrade: valid, upgrade_iterations: Math.max(PASSWORD_ITERATIONS, iterations) }; }
    finally { candidate.fill(0); }
  }
  // The only unversioned historical format is canonical 32-byte SHA-256 base64.
  const hash = decode(item.password_hash, 32);
  if (!hash) { dummyPasswordWork(password); return invalid; }
  const input = encoder.encode(`${item.salt}:${password}`);
  try {
    const candidate = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
    const valid = equalBytes(candidate, hash);
    candidate.fill(0);
    return { valid, needs_upgrade: valid };
  } finally { input.fill(0); }
}
