// Stub viewer for v1 — the body is replaced by the auth feature; the exported signature is the contract.

export type StudioViewer = {
  id: string;
  staffId: string;
  displayName: string;
};

export async function requireStudioSession(): Promise<StudioViewer> {
  return { id: "demo", staffId: "maya", displayName: "Maya Patel" };
}
