import { EqueryClient } from "../src/index";

/**
 * These tests focus on callback delivery and deduplication behavior.
 * We assert the number of underlying fetcher invocations and onComplete calls
 * for same-key (deduped) vs distinct-key (non-deduped) scenarios.
 */

describe("callbacks + deduplication", () => {
  it("deduplicates fetchers sharing the same key and delivers callbacks once per observer", async () => {
    const client = new EqueryClient();

    const fetcherFn = jest.fn(async () => ({ value: 42 }));
    const fetcher = { key: "shared.key", fn: fetcherFn } as const;

    const q1 = client.useFetch(fetcher);
    const q2 = client.useFetch(fetcher);

    // Same key -> dedup
    expect(q1.getQueryId()).toBe(q2.getQueryId());

    const cb1 = jest.fn();
    const cb2 = jest.fn();

    await Promise.all([
      new Promise<void>((resolve, reject) => {
        q1.onComplete((res) => {
          try {
            cb1(res);
            expect(res.isSuccess).toBe(true);
            expect(res.data).toEqual({ value: 42 });
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      }),
      new Promise<void>((resolve, reject) => {
        q2.onComplete((res) => {
          try {
            cb2(res);
            expect(res.isSuccess).toBe(true);
            expect(res.data).toEqual({ value: 42 });
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      }),
    ]);

    // Underlying fetcher should run once; each observer callback exactly once.
    expect(fetcherFn).toHaveBeenCalledTimes(1);
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it("does not deduplicate different keys and triggers separate callbacks", async () => {
    const client = new EqueryClient();

    const fetcherFnA = jest.fn(async () => ({ who: "A" }));
    const fetcherFnB = jest.fn(async () => ({ who: "B" }));

    const fetcherA = { key: "key.A", fn: fetcherFnA } as const;
    const fetcherB = { key: "key.B", fn: fetcherFnB } as const;

    const qA = client.useFetch(fetcherA);
    const qB = client.useFetch(fetcherB);

    // Different keys -> no dedup
    expect(qA.getQueryId()).not.toBe(qB.getQueryId());

    const cbA = jest.fn();
    const cbB = jest.fn();

    await Promise.all([
      new Promise<void>((resolve, reject) => {
        qA.onComplete((res) => {
          try {
            cbA(res);
            expect(res.isSuccess).toBe(true);
            expect(res.data).toEqual({ who: "A" });
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      }),
      new Promise<void>((resolve, reject) => {
        qB.onComplete((res) => {
          try {
            cbB(res);
            expect(res.isSuccess).toBe(true);
            expect(res.data).toEqual({ who: "B" });
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      }),
    ]);

    expect(fetcherFnA).toHaveBeenCalledTimes(1);
    expect(fetcherFnB).toHaveBeenCalledTimes(1);
    expect(cbA).toHaveBeenCalledTimes(1);
    expect(cbB).toHaveBeenCalledTimes(1);
  });
});
