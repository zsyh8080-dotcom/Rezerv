const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveAesKey(secretMaterial: string): Promise<CryptoKey> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    encoder.encode(secretMaterial)
  );
  return globalThis.crypto.subtle.importKey(
    'raw',
    digest,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptSecret(
  plaintext: string,
  serverSecretKey: string
): Promise<string> {
  if (!serverSecretKey || serverSecretKey.length < 8) {
    throw new Error('Server encryption key is missing or too short.');
  }
  const key = await deriveAesKey(serverSecretKey);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext)
  );
  return `v1:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(encrypted))}`;
}

export async function decryptSecret(
  ciphertext: string,
  serverSecretKey: string
): Promise<string> {
  if (!ciphertext.startsWith('v1:')) {
    throw new Error('Unsupported ciphertext format.');
  }
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted payload.');
  }
  const iv = base64ToBytes(parts[1]);
  const data = base64ToBytes(parts[2]);
  const key = await deriveAesKey(serverSecretKey);
  const decrypted = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );
  return decoder.decode(decrypted);
}

/**
 * Scrubs any credential, cookie, or token substrings from error messages before logging or UI display.
 */
export function redactSecrets(message: string, secretsToMask: Array<string | undefined | null>): string {
  let clean = message;
  for (const s of secretsToMask) {
    if (s && s.length >= 3) {
      clean = clean.split(s).join('[محرمانه]');
    }
  }
  clean = clean.replace(/(password|passwd|pwd|cookie|token|authorization)=([^&\s;]+)/gi, '$1=[محرمانه]');
  return clean;
}
