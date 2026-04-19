/**
 * Aurora E2E Encryption — ECDH P-256 + AES-GCM 256-bit
 * Private chats only. Group messages are not E2E encrypted.
 *
 * Format of encrypted message_text:
 *   [AURORA_ENC]{"ct":"<base64>","iv":"<base64>"}[/AURORA_ENC]
 */

const KEY_STORE = 'aurora_e2e_keypair';
const ENC_PREFIX = '[AURORA_ENC]';
const ENC_SUFFIX = '[/AURORA_ENC]';

let _keyPair: CryptoKeyPair | null = null;
// userId → base64-spki public key
const _pubKeyCache = new Map<number, string>();
// partner public key base64 → derived AES key
const _sharedKeyCache = new Map<string, CryptoKey>();

// ─── helpers ────────────────────────────────────────────────────────────────

function ab2b64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let s = '';
    bytes.forEach(b => (s += String.fromCharCode(b)));
    return btoa(s);
}

function b642ab(b64: string): ArrayBuffer {
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
}

// ─── key pair ───────────────────────────────────────────────────────────────

export async function getOrCreateKeyPair(): Promise<CryptoKeyPair> {
    if (_keyPair) return _keyPair;
    const stored = localStorage.getItem(KEY_STORE);
    if (stored) {
        try {
            const { priv, pub } = JSON.parse(stored);
            const privateKey = await crypto.subtle.importKey(
                'pkcs8', b642ab(priv),
                { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']
            );
            const publicKey = await crypto.subtle.importKey(
                'spki', b642ab(pub),
                { name: 'ECDH', namedCurve: 'P-256' }, true, []
            );
            _keyPair = { privateKey, publicKey };
            return _keyPair;
        } catch {
            localStorage.removeItem(KEY_STORE);
        }
    }
    _keyPair = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']
    );
    const priv = ab2b64(await crypto.subtle.exportKey('pkcs8', _keyPair.privateKey));
    const pub  = ab2b64(await crypto.subtle.exportKey('spki',  _keyPair.publicKey));
    localStorage.setItem(KEY_STORE, JSON.stringify({ priv, pub }));
    return _keyPair;
}

/** Returns own public key as base64-SPKI string (to upload to server). */
export async function getOwnPublicKey(): Promise<string> {
    const kp = await getOrCreateKeyPair();
    return ab2b64(await crypto.subtle.exportKey('spki', kp.publicKey));
}

// ─── shared key derivation ──────────────────────────────────────────────────

async function deriveSharedKey(theirPubB64: string): Promise<CryptoKey> {
    if (_sharedKeyCache.has(theirPubB64)) return _sharedKeyCache.get(theirPubB64)!;
    const kp = await getOrCreateKeyPair();
    const theirKey = await crypto.subtle.importKey(
        'spki', b642ab(theirPubB64),
        { name: 'ECDH', namedCurve: 'P-256' }, false, []
    );
    const aesKey = await crypto.subtle.deriveKey(
        { name: 'ECDH', public: theirKey },
        kp.privateKey,
        { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
    _sharedKeyCache.set(theirPubB64, aesKey);
    return aesKey;
}

// ─── public key cache ────────────────────────────────────────────────────────

export function cachePublicKey(userId: number, pubKeyB64: string) {
    _pubKeyCache.set(userId, pubKeyB64);
}

export function getCachedPublicKey(userId: number): string | undefined {
    return _pubKeyCache.get(userId);
}

// ─── encrypt / decrypt ──────────────────────────────────────────────────────

/**
 * Encrypt plaintext with AES-GCM derived from ECDH shared secret.
 * Returns the full [AURORA_ENC]....[/AURORA_ENC] string, or null on failure.
 */
export async function encryptMessage(
    text: string,
    partnerPubKeyB64: string
): Promise<string | null> {
    try {
        const key = await deriveSharedKey(partnerPubKeyB64);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            new TextEncoder().encode(text)
        );
        const payload = JSON.stringify({ ct: ab2b64(ct), iv: ab2b64(iv.buffer) });
        return `${ENC_PREFIX}${payload}${ENC_SUFFIX}`;
    } catch {
        return null;
    }
}

/**
 * Detect and decrypt an encrypted message.
 * Returns { text, encrypted: true } or { text: original, encrypted: false }.
 */
export async function decryptMessage(
    raw: string,
    partnerPubKeyB64: string | undefined
): Promise<{ text: string; encrypted: boolean }> {
    if (!raw.startsWith(ENC_PREFIX) || !raw.endsWith(ENC_SUFFIX)) {
        return { text: raw, encrypted: false };
    }
    if (!partnerPubKeyB64) {
        return { text: '🔒 Зашифровано', encrypted: true };
    }
    try {
        const json = raw.slice(ENC_PREFIX.length, -ENC_SUFFIX.length);
        const { ct, iv } = JSON.parse(json);
        const key = await deriveSharedKey(partnerPubKeyB64);
        const plain = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: b642ab(iv) },
            key,
            b642ab(ct)
        );
        return { text: new TextDecoder().decode(plain), encrypted: true };
    } catch {
        return { text: '🔒 Зашифровано', encrypted: true };
    }
}

export function isEncryptedMessage(text: string | null | undefined): boolean {
    return !!text && text.startsWith(ENC_PREFIX) && text.endsWith(ENC_SUFFIX);
}
