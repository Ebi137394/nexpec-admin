// ════════════════════════════════════════════════════════════════════════════
//  src/core/ml/providers.expo.ts — concrete capability providers for Expo/RN
//
//  Implements the shared-core ML provider interfaces using ONLY packages that
//  already ship in this app (expo-crypto, expo-file-system) — zero new native
//  dependencies, $0. All file I/O is sandboxed to the app cache directory.
// ════════════════════════════════════════════════════════════════════════════

import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system';
import type {
  HashProvider,
  ArtifactFileStore,
  DownloadResult,
  ManifestCache,
  SignatureVerifier,
} from '@nexpec/shared-core';

/* ─── byte/encoding helpers (pure JS, no deps) ─────────────────────────── */

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    const h = bytes[i].toString(16);
    s += h.length === 1 ? '0' + h : h;
  }
  return s;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64LOOKUP = (() => {
  const t = new Int16Array(256).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

function base64ToBytes(b64: string): Uint8Array {
  const g = globalThis as unknown as { atob?: (s: string) => string };
  if (typeof g.atob === 'function') {
    const bin = g.atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  let len = Math.floor(b64.length * 0.75);
  if (b64[b64.length - 1] === '=') { len--; if (b64[b64.length - 2] === '=') len--; }
  const bytes = new Uint8Array(len > 0 ? len : 0);
  let p = 0;
  for (let i = 0; i < b64.length; i += 4) {
    const e1 = B64LOOKUP[b64.charCodeAt(i)];
    const e2 = B64LOOKUP[b64.charCodeAt(i + 1)];
    const e3 = B64LOOKUP[b64.charCodeAt(i + 2)];
    const e4 = B64LOOKUP[b64.charCodeAt(i + 3)];
    if (e1 < 0 || e2 < 0) break;
    if (p < len) bytes[p++] = (e1 << 2) | (e2 >> 4);
    if (e3 >= 0 && p < len) bytes[p++] = ((e2 & 15) << 4) | (e3 >> 2);
    if (e4 >= 0 && p < len) bytes[p++] = ((e3 & 3) << 6) | (e4 & 63);
  }
  return bytes;
}

function pemToDer(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/[\r\n\s]/g, '');
  return base64ToBytes(b64);
}

/* ─── HashProvider (expo-crypto, raw-byte SHA-256) ─────────────────────── */

export const expoHashProvider: HashProvider = {
  async sha256Hex(bytes: Uint8Array): Promise<string> {
    const anyCrypto = Crypto as unknown as {
      digest?: (alg: unknown, data: Uint8Array) => Promise<ArrayBuffer | Uint8Array>;
    };
    if (typeof anyCrypto.digest === 'function') {
      const out = await anyCrypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
      return toHex(out instanceof Uint8Array ? out : new Uint8Array(out));
    }
    // Fail closed: a base64-string hash would not match a raw-byte SHA-256, so
    // we refuse rather than emit a hash that can never validate.
    throw new Error('[ml] expo-crypto digest() unavailable — cannot verify model integrity');
  },
};

/* ─── ArtifactFileStore (expo-file-system, content-addressed cache) ─────── */

const ROOT = (FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '') + 'ml-models/';

async function ensureRoot(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(ROOT);
    if (!info.exists) await FileSystem.makeDirectoryAsync(ROOT, { intermediates: true });
  } catch {
    /* best-effort; downstream ops will surface a real error if dir is missing */
  }
}

export const expoFileStore: ArtifactFileStore = {
  async findCached(sha256: string): Promise<string | null> {
    await ensureRoot();
    const p = ROOT + sha256 + '.bin';
    const info = await FileSystem.getInfoAsync(p);
    return info.exists ? p : null;
  },
  async download(url: string, sha256: string): Promise<DownloadResult> {
    await ensureRoot();
    const tmp = ROOT + sha256 + '.download';
    const res = await FileSystem.downloadAsync(url, tmp);
    const info = await FileSystem.getInfoAsync(res.uri, { size: true });
    const size = (info as { size?: number }).size ?? 0;
    return { localUri: res.uri, sizeBytes: size };
  },
  async readBytes(localUri: string): Promise<Uint8Array> {
    const b64 = await FileSystem.readAsStringAsync(localUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return base64ToBytes(b64);
  },
  async commit(localUri: string, sha256: string): Promise<string> {
    const final = ROOT + sha256 + '.bin';
    try {
      const info = await FileSystem.getInfoAsync(final);
      if (info.exists) {
        await FileSystem.deleteAsync(localUri, { idempotent: true });
        return final;
      }
    } catch {
      /* fall through to move */
    }
    await FileSystem.moveAsync({ from: localUri, to: final });
    return final;
  },
  async discard(localUri: string): Promise<void> {
    try {
      await FileSystem.deleteAsync(localUri, { idempotent: true });
    } catch {
      /* never throws */
    }
  },
};

/* ─── ManifestCache (offline-resilient JSON file) ──────────────────────── */

export const expoManifestCache: ManifestCache = {
  async read(key: string): Promise<unknown | null> {
    try {
      const p = ROOT + 'manifest_' + key + '.json';
      const info = await FileSystem.getInfoAsync(p);
      if (!info.exists) return null;
      return JSON.parse(await FileSystem.readAsStringAsync(p));
    } catch {
      return null;
    }
  },
  async write(key: string, manifest: unknown): Promise<void> {
    try {
      await ensureRoot();
      const p = ROOT + 'manifest_' + key + '.json';
      await FileSystem.writeAsStringAsync(p, JSON.stringify(manifest));
    } catch {
      /* cache is best-effort */
    }
  },
};

/* ─── SignatureVerifier (Web Crypto where present; fail-closed on RN) ───── */
//
//  On web/Node (crypto.subtle present) this verifies Ed25519 / RSA-PSS /
//  ECDSA-P256 signatures. On bare React Native, subtle is typically absent, so
//  available() returns false and the runtime fails closed (a signed model will
//  not load). To enable full on-device asymmetric verification, inject a
//  pure-JS verifier (e.g. @noble/curves) via setSignatureVerifier() — see docs.

export const subtleSignatureVerifier: SignatureVerifier = {
  available(): boolean {
    try {
      return typeof (globalThis as { crypto?: { subtle?: { verify?: unknown } } })?.crypto?.subtle
        ?.verify === 'function';
    } catch {
      return false;
    }
  },
  async verify({ message, signatureB64, publicKeyPem, alg }): Promise<boolean> {
    try {
      const subtle = (globalThis as { crypto: { subtle: SubtleCrypto } }).crypto.subtle;
      const der = pemToDer(publicKeyPem);
      const sig = base64ToBytes(signatureB64);
      let key: CryptoKey;
      let params: AlgorithmIdentifier | EcdsaParams | RsaPssParams;
      if (alg === 'ed25519') {
        key = await subtle.importKey('spki', der as BufferSource, { name: 'Ed25519' } as unknown as AlgorithmIdentifier, false, ['verify']);
        params = { name: 'Ed25519' } as AlgorithmIdentifier;
      } else if (alg === 'rsa-pss-sha256') {
        key = await subtle.importKey('spki', der as BufferSource, { name: 'RSA-PSS', hash: 'SHA-256' }, false, ['verify']);
        params = { name: 'RSA-PSS', saltLength: 32 } as RsaPssParams;
      } else if (alg === 'ecdsa-p256-sha256') {
        key = await subtle.importKey('spki', der as BufferSource, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
        params = { name: 'ECDSA', hash: 'SHA-256' } as EcdsaParams;
      } else {
        return false;
      }
      return await subtle.verify(params, key, sig as BufferSource, message as BufferSource);
    } catch {
      return false;
    }
  },
};
