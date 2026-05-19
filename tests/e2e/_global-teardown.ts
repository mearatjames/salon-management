// tests/e2e/_global-teardown.ts
//
// Counterpart to `_global-setup.ts` — stops the singleton Square stub
// server after the Playwright run completes. Runs in the same process as
// globalSetup, so it can reach the handle stashed on `globalThis`.

import { clearStubLock, type ServerHandle } from "./_square-server-stub";

declare global {
  // eslint-disable-next-line no-var
  var __SQUARE_STUB_HANDLE__: ServerHandle | undefined;
}

export default async function globalTeardown(): Promise<void> {
  const handle = globalThis.__SQUARE_STUB_HANDLE__;
  if (handle) {
    await handle.close();
    globalThis.__SQUARE_STUB_HANDLE__ = undefined;
  }
  clearStubLock();
}
