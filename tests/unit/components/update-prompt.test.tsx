import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { toast } from "sonner";

import { UpdatePrompt } from "@/components/lacquer/update-prompt.client";

vi.mock("sonner", () => ({ toast: vi.fn() }));
vi.mock("@/lib/build-id", () => ({ BUILD_ID: "build-a" }));

const fetchMock = vi.fn();

function versionResponse(buildId: string) {
  return Promise.resolve(Response.json({ buildId }));
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("<UpdatePrompt />", () => {
  it("does not check on mount", () => {
    render(<UpdatePrompt />);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stays quiet when the server reports the same build", async () => {
    fetchMock.mockReturnValue(versionResponse("build-a"));
    render(<UpdatePrompt />);
    setVisibility("visible");
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/version", { cache: "no-store" })
    );
    await Promise.resolve();
    expect(toast).not.toHaveBeenCalled();
  });

  it("shows a persistent refresh prompt when a newer build is live", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    fetchMock.mockReturnValue(versionResponse("build-b"));
    render(<UpdatePrompt />);
    setVisibility("visible");

    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    const [message, options] = vi.mocked(toast).mock.calls[0];
    expect(message).toBe("A new version of Tang Nails is ready.");
    expect(options).toMatchObject({ id: "app-update", duration: Infinity });

    const action = options?.action as { label: string; onClick: () => void };
    expect(action.label).toBe("Refresh");
    action.onClick();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("skips the check while the app is hidden", () => {
    render(<UpdatePrompt />);
    setVisibility("hidden");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores fetch failures", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<UpdatePrompt />);
    setVisibility("visible");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(toast).not.toHaveBeenCalled();
  });

  it("checks every 5 min while visible", async () => {
    vi.useFakeTimers();
    fetchMock.mockReturnValue(versionResponse("build-a"));
    render(<UpdatePrompt />);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("re-shows the prompt on return to the foreground without refetching", async () => {
    vi.useFakeTimers();
    fetchMock.mockReturnValue(versionResponse("build-b"));
    render(<UpdatePrompt />);
    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(toast).toHaveBeenCalledTimes(1);

    // Interval stops fetching once the build is known to be stale.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledTimes(1);

    setVisibility("hidden");
    setVisibility("visible");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledTimes(2);
  });
});
