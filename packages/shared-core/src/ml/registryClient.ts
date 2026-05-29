// ════════════════════════════════════════════════════════════════════════════
//  ml/registryClient.ts — typed wrapper around the ml_resolve_models RPC
//
//  Decoupled from @supabase/supabase-js via the minimal RpcLike interface (the
//  Supabase client satisfies it). This is the ONE place that knows the RPC name
//  and argument shape, so a server-side rename is a single-file compile break,
//  not a runtime surprise scattered across two apps.
// ════════════════════════════════════════════════════════════════════════════

import type { DeviceProfile, ModelKind, ResolveResponse } from './types';
import { parseResolveResponse } from './schemas';

export interface RpcLike {
  rpc(fn: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

export class ModelRegistryError extends Error {
  readonly code: string;
  readonly cause?: unknown;
  constructor(code: string, cause?: unknown) {
    super(`[model-registry] ${code}`);
    this.name = 'ModelRegistryError';
    this.code = code;
    this.cause = cause;
  }
}

export interface ModelRegistryClient {
  resolve(profile: DeviceProfile, kind?: ModelKind): Promise<ResolveResponse>;
}

export function createModelRegistryClient(client: RpcLike): ModelRegistryClient {
  return {
    async resolve(profile, kind) {
      const { data, error } = await client.rpc('ml_resolve_models', {
        p_kind: kind ?? null,
        p_device_tier: profile.tier,
        p_os: profile.os,
        p_app_version: profile.appVersion ?? null,
      });
      if (error) throw new ModelRegistryError('resolve_failed', error);
      try {
        return parseResolveResponse(data);
      } catch (e) {
        throw new ModelRegistryError('resolve_malformed', e);
      }
    },
  };
}
