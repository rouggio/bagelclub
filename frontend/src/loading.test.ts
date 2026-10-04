import { describe, it, expect, beforeEach } from "vitest";
import {
  pendingCount, isLoading, startLoading, stopLoading,
  resetLoading, subscribeLoading, trackLoading,
} from "./loading.js";

beforeEach(() => {
  resetLoading();
});

describe("loading store", () => {
  it("starts at zero", () => {
    expect(pendingCount()).toBe(0);
    expect(isLoading()).toBe(false);
  });

  it("counts parallel transactions", () => {
    startLoading();
    startLoading();
    expect(pendingCount()).toBe(2);
    expect(isLoading()).toBe(true);
    stopLoading();
    expect(isLoading()).toBe(true);
    stopLoading();
    expect(isLoading()).toBe(false);
  });

  it("never goes negative", () => {
    stopLoading();
    expect(pendingCount()).toBe(0);
  });

  it("notifies subscribers", () => {
    const seen: number[] = [];
    const unsub = subscribeLoading((n) => seen.push(n));
    startLoading();
    stopLoading();
    unsub();
    startLoading();
    // initial emit (0) + start (1) + stop (0); post-unsub start is silent
    expect(seen).toEqual([0, 1, 0]);
    resetLoading();
  });

  it("trackLoading wraps promises incl. failures", async () => {
    await trackLoading(Promise.resolve(1));
    expect(isLoading()).toBe(false);
    await trackLoading(Promise.reject(new Error("x"))).catch(() => {});
    expect(isLoading()).toBe(false);
  });
});
