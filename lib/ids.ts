// Crockford base32: no I, L, O or U, so codes survive being read aloud.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Uses Web Crypto rather than node:crypto so the same helper works in
 * middleware, which runs on the Edge runtime.
 */
export function randomId(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);

  let out = "";
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

/** Game URLs are the only access control, so ids must not be enumerable. */
export const newGameId = () => randomId(12);

/** Short enough to read aloud when a player needs to restore their session. */
export const newClientId = () => randomId(10);

const CODE = /^[0-9A-HJKMNP-TV-Z]+$/;

export const isValidGameId = (id: string) => id.length === 12 && CODE.test(id);
export const isValidClientId = (id: string) => id.length === 10 && CODE.test(id);
