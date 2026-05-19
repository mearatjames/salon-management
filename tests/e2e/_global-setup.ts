// tests/e2e/_global-setup.ts
//
// Boots the singleton Square stub server (issue #41). The previous pattern
// — each spec called `startSquareServerStub(4567)` in `beforeAll` — collides
// under `workers > 1` because two worker processes both try to bind
// `127.0.0.1:4567` and the second hits `EADDRINUSE`.
//
// Lifecycle:
//   - This file runs ONCE in the Playwright runner process before workers
//     spawn. It binds the stub server and stashes the handle on the
//     `globalThis` object so `_global-teardown.ts` can stop it.
//   - Worker processes use `getStubControls()` to mutate stub state via
//     the `/__control/*` HTTP endpoints the server exposes.
//   - A cross-worker file lock (`acquireStubLock` / `releaseStubLock`)
//     serializes Square-using specs so they don't trample each other's
//     primed responses.

import {
  clearStubLock,
  clearTicketStateLock,
  startSquareServerStub,
  type ServerHandle,
} from "./_square-server-stub";

declare global {
  var __SQUARE_STUB_HANDLE__: ServerHandle | undefined;
}

export default async function globalSetup(): Promise<void> {
  // Clear lock files left behind by crashed workers from prior runs.
  clearStubLock();
  clearTicketStateLock();

  if (globalThis.__SQUARE_STUB_HANDLE__) {
    // Hot-reload guard — Playwright's TS transformer can re-execute this
    // file under some configurations.
    return;
  }
  const handle = await startSquareServerStub(4567);
  globalThis.__SQUARE_STUB_HANDLE__ = handle;
}
