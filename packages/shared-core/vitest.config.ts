import { defineConfig } from 'vitest/config';

// P3.1 — runner for shared-core's moat tests. Coverage is scoped to the modules
// that ARE the business risk (cryptographic/AI canonical, the job state machine,
// the integrity scorer), not a blanket repo percentage.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/ml/canonical.ts', 'src/domain/jobStatus.ts', 'src/integrity/riskScore.ts'],
    },
  },
});
