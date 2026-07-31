import { defineConfig } from "vitest/config";
import path from "node:path";

// .mts, not .ts: the repo has no "type": "module", so a .ts config is loaded as
// CommonJS and Vite warns about the ESM syntax in it. The extension resolves it
// without setting "type": "module" repo-wide, which would change how every
// other tool in the project resolves modules.
const rootDir = import.meta.dirname;

/**
 * Unit tests for the platform's pure logic.
 *
 * Scope is deliberate: functions that decide something important and can be
 * checked without a database, a network call or a running Next server. That
 * covers the code where a silent regression is most expensive — the outbound
 * email review gates, inbound classification, link safety, product
 * entitlement grouping and the Dublin date maths.
 *
 * Two aliases make the app's modules loadable from a plain Node test run:
 *   @/…         the same path alias tsconfig uses.
 *   server-only  a no-op stub. The real package throws by design when imported
 *                outside a React Server Component, which is exactly the
 *                guard-rail we want in the app and exactly what makes a
 *                server-only module untestable without it.
 */
export default defineConfig({
  resolve: {
    alias: {
      "server-only": path.resolve(rootDir, "test/stubs/server-only.ts"),
      "@": path.resolve(rootDir),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "test/**/*.test.ts"],
  },
});
