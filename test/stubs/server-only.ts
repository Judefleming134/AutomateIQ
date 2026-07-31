/**
 * No-op stand-in for the `server-only` package during tests.
 *
 * The real package throws the moment it's imported into a client bundle —
 * a guard-rail worth keeping in the app, and the reason a module that uses it
 * can't be imported by a plain Node test run. Aliased in vitest.config.ts only;
 * the app build never sees this file.
 */
export {};
