// Web Push 보내기 — RFC 8291(aes128gcm 암호화) + RFC 8292(VAPID). WebCrypto만 사용 (Deno·Node 공통)
const te = new TextEncoder();

export const b64u = {
  enc(buf: ArrayBuffer | Uint8Array): string {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(str: string): Uint8Array {
    let s = String(str || '').replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
    const bin = atob(s); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  },
};

const concat = (...arrs: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(arrs.reduce((a, b) => a + b.length, 0)); let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
};

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
// HKDF (SHA-256), 출력 32바이트 이하
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, len);
}

export type VapidKeys = { publicKey: string; privateJwk: JsonWebKey };

export async function generateVapidKeys(): Promise<VapidKeys> {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey) as JsonWebKey;
  return { publicKey: b64u.enc(raw), privateJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d } };
}

export async function vapidHeader(endpoint: string, keys: VapidKeys, subject: string): Promise<string> {
  const aud = new URL(endpoint).origin;
  const head = b64u.enc(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u.enc(te.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(head + '.' + claims)));
  return `vapid t=${head}.${claims}.${b64u.enc(sig)}, k=${keys.publicKey}`;
}

// 받는 기기의 공개키(p256dh)·auth로 내용 암호화 → 요청 본문
export async function encryptPayload(payload: Uint8Array, p256dh: string, auth: string): Promise<Uint8Array> {
  const uaPub = b64u.dec(p256dh); const authSecret = b64u.dec(auth);
  if (uaPub.length !== 65 || authSecret.length < 16) throw new Error('구독 키 형식이 올바르지 않아요');
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const ikm = await hkdf(authSecret, shared, concat(te.encode('WebPush: info\0'), uaPub, asPub), 32);
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(payload, new Uint8Array([2]))));
  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

export type Sub = { endpoint: string; p256dh: string; auth: string };
export async function sendPush(sub: Sub, payload: string, keys: VapidKeys, subject: string, opts: { ttl?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high'; timeoutMs?: number } = {}): Promise<{ status: number; text: string }> {
  const body = await encryptPayload(te.encode(payload), sub.p256dh, sub.auth);
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 10000);
  try {
    const res = await fetch(sub.endpoint, {
      method: 'POST', signal: ctl.signal,
      headers: {
        'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
        TTL: String(opts.ttl ?? 86400), Urgency: opts.urgency ?? 'normal',
        Authorization: await vapidHeader(sub.endpoint, keys, subject),
      },
      body,
    });
    const text = res.ok ? '' : (await res.text().catch(() => '')).slice(0, 200);
    return { status: res.status, text };
  } finally { clearTimeout(t); }
}
