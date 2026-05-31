// ════════════════════════════════════════════════════════════════════════════
//  src/core/ml/runtime.ts — the on-device model runtime orchestrator
//
//  Lifecycle for every model: resolve (capability-gated, offline-cached) →
//  signed-URL download → raw-byte SHA-256 → integrity + signature verify
//  (FAIL-CLOSED) → content-addressed cache → backend load → run.
//
//  LAW 1: with the flag off, every method short-circuits (no network/IO).
//  LAW 2: the only network calls are to our own Supabase (RPC + Storage).
//  LAW 3: nothing is ever executed before it verifies; invalid files are
//         discarded, never cached.
// ════════════════════════════════════════════════════════════════════════════

import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import {
  createModelRegistryClient,
  verifyDownloadedArtifact,
  type ModelArtifact,
  type ModelKind,
  type DeviceProfile,
  type OsConstraint,
  type ResolveResponse,
  type SignatureVerifier,
} from '@nexpec/shared-core';
import {
  ML_RUNTIME_ENABLED,
  ML_ALLOW_UNSIGNED,
  ML_SIGNING_PUBLIC_KEY_PEM,
  NEXPEC_ML_SIGNING_KEY_ID,
} from './flags';
import {
  expoHashProvider,
  expoFileStore,
  expoManifestCache,
  subtleSignatureVerifier,
} from './providers.expo';
import { getBackend, type LoadedModel } from './backends';

export type ModelStatus =
  | 'disabled'
  | 'idle'
  | 'resolving'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'unavailable'
  | 'error';

/** Fine-grained pipeline stages, surfaced via the optional ensure() callback
 *  (used by diagnostics / the pipeline-check screen). */
export type ModelStage =
  | 'resolving'
  | 'cache-hit'
  | 'downloading'
  | 'hashing'
  | 'verifying'
  | 'committing'
  | 'ready';

export class ModelDisabledError extends Error {
  constructor() {
    super('[ml] runtime disabled');
    this.name = 'ModelDisabledError';
  }
}

export class ModelUnavailableError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super('[ml] unavailable: ' + reason);
    this.name = 'ModelUnavailableError';
    this.reason = reason;
  }
}

export interface ModelHandle {
  artifact: ModelArtifact;
  localUri: string;
}

function detectOs(): OsConstraint {
  return Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'any';
}

// Pluggable signature verifier. Defaults to Web Crypto (web/Node). On bare RN,
// inject a pure-JS verifier (e.g. @noble/curves) to enable on-device signature
// checks — until then signed models fail closed (see docs).
let _verifier: SignatureVerifier = subtleSignatureVerifier;
export function setSignatureVerifier(v: SignatureVerifier): void {
  _verifier = v;
}

class NexpecModelRuntime {
  private registry = createModelRegistryClient(supabase as unknown as { rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> });
  private manifests = new Map<string, ResolveResponse>();
  private loaded = new Map<string, LoadedModel>();

  profile: DeviceProfile = { tier: 'standard', os: detectOs() };

  get enabled(): boolean {
    return ML_RUNTIME_ENABLED;
  }

  setDeviceProfile(p: Partial<DeviceProfile>): void {
    this.profile = { ...this.profile, ...p };
  }

  async resolve(kind?: ModelKind, opts?: { force?: boolean }): Promise<ResolveResponse> {
    const key = kind ?? 'all';
    if (!this.enabled) {
      return { generatedAt: new Date().toISOString(), device: { tier: this.profile.tier, os: this.profile.os }, models: [] };
    }
    const cached = this.manifests.get(key);
    if (cached && !opts?.force) return cached;
    try {
      const m = await this.registry.resolve(this.profile, kind);
      this.manifests.set(key, m);
      void expoManifestCache.write(key, m);
      return m;
    } catch (e) {
      const offline = await expoManifestCache.read(key);
      if (offline) {
        const m = offline as ResolveResponse;
        this.manifests.set(key, m);
        return m;
      }
      throw e;
    }
  }

  pick(manifest: ResolveResponse, kind: ModelKind, slug?: string): ModelArtifact | null {
    const cands = manifest.models.filter((m) => m.kind === kind && (!slug || m.slug === slug));
    if (cands.length === 0) return null;
    return cands.slice().sort((a, b) => b.version - a.version)[0];
  }

  /** Ensure a verified model file is on disk; returns its local uri.
   *  `onStage` is an optional progress hook for diagnostics — it does not
   *  change behavior and may be omitted. */
  async ensure(
    kind: ModelKind,
    slug?: string,
    onStage?: (stage: ModelStage) => void,
  ): Promise<ModelHandle> {
    if (!this.enabled) throw new ModelDisabledError();
    onStage?.('resolving');
    const manifest = await this.resolve(kind);
    const artifact = this.pick(manifest, kind, slug);
    if (!artifact) throw new ModelUnavailableError('no_artifact');

    const cachedUri = await expoFileStore.findCached(artifact.sha256);
    if (cachedUri) {
      onStage?.('cache-hit');
      onStage?.('ready');
      return { artifact, localUri: cachedUri };
    }

    onStage?.('downloading');
    const url = await this.signedUrl(artifact);
    const dl = await expoFileStore.download(url, artifact.sha256);
    try {
      onStage?.('hashing');
      const bytes = await expoFileStore.readBytes(dl.localUri);
      const actualSha256Hex = await expoHashProvider.sha256Hex(bytes);

      onStage?.('verifying');
      const result = await verifyDownloadedArtifact({
        artifact,
        actualSha256Hex,
        options: {
          requireSignature: !ML_ALLOW_UNSIGNED,
          publicKeyPem: ML_SIGNING_PUBLIC_KEY_PEM,
          // Explicit id→key map so an artifact's signing_key_id resolves
          // deterministically (and future multi-key rotation just adds entries).
          signingKeys: ML_SIGNING_PUBLIC_KEY_PEM
            ? { [NEXPEC_ML_SIGNING_KEY_ID]: ML_SIGNING_PUBLIC_KEY_PEM }
            : undefined,
          verifier: _verifier,
        },
      });
      if (!result.ok) {
        await expoFileStore.discard(dl.localUri);
        throw new ModelUnavailableError('integrity_' + result.reason);
      }

      onStage?.('committing');
      const finalUri = await expoFileStore.commit(dl.localUri, artifact.sha256);
      onStage?.('ready');
      return { artifact, localUri: finalUri };
    } catch (e) {
      await expoFileStore.discard(dl.localUri);
      throw e;
    }
  }

  private async signedUrl(a: ModelArtifact): Promise<string> {
    const { data, error } = await supabase.storage
      .from(a.storageBucket)
      .createSignedUrl(a.storagePath, 600);
    if (error || !data?.signedUrl) throw new ModelUnavailableError('signed_url');
    return data.signedUrl;
  }

  async load(kind: ModelKind, slug?: string): Promise<LoadedModel> {
    const key = kind + '/' + (slug ?? '');
    const existing = this.loaded.get(key);
    if (existing) return existing;
    const handle = await this.ensure(kind, slug);
    const backend = getBackend(handle.artifact.runtime);
    const lm = await backend.load({
      localUri: handle.localUri,
      params: handle.artifact.params,
      runtime: handle.artifact.runtime,
      slug: handle.artifact.slug,
      version: handle.artifact.version,
    });
    this.loaded.set(key, lm);
    return lm;
  }

  async infer<TIn = unknown, TOut = unknown>(kind: ModelKind, input: TIn, slug?: string): Promise<TOut> {
    const lm = await this.load(kind, slug);
    return (await lm.run(input)) as TOut;
  }

  unload(kind: ModelKind, slug?: string): void {
    const key = kind + '/' + (slug ?? '');
    const lm = this.loaded.get(key);
    if (lm) {
      try {
        lm.release();
      } catch {
        /* ignore */
      }
      this.loaded.delete(key);
    }
  }
}

let _runtime: NexpecModelRuntime | null = null;

/** Lazily-constructed runtime singleton. Constructing it has no side effects
 *  beyond binding to the already-initialized Supabase client. */
export function getModelRuntime(): NexpecModelRuntime {
  if (!_runtime) _runtime = new NexpecModelRuntime();
  return _runtime;
}

export type { NexpecModelRuntime };
