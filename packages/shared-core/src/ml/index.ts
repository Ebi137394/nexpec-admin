// ════════════════════════════════════════════════════════════════════════════
//  @nexpec/shared-core/ml — Phase A.5 on-device model runtime contracts
//
//  Pure-TypeScript spine for the signed model registry + integrity gate. The
//  platform shells (mobile src/core/ml, web) supply concrete HashProvider /
//  SignatureVerifier / ArtifactFileStore implementations and wire the runtime.
// ════════════════════════════════════════════════════════════════════════════

export * from './types';
export * from './canonical';
export * from './providers';
export * from './verify';
export * from './schemas';
export * from './registryClient';
export * from './defectTaxonomy';
export * from './defectResult';
export * from './segDecode';
export * from './aiAssist';
