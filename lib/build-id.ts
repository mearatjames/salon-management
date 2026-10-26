// The build this bundle was compiled from. Set by `next.config.ts` and
// inlined at build time, so a page that has been open since an older deploy
// keeps reporting that older ID while `/api/version` reports the new one.
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "development";
