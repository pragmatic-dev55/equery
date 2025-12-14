import { useFetch } from "../src/index";

describe("useFetch - Core Fetching", () => {
  const delay = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  it("should time out slow requests when timeout is set", (done) => {
    const url = "https://api.example.com/slow";

    const originalFetch = global.fetch;

    // @ts-ignore
    global.fetch = jest.fn(
      (_: string, options?: any) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(
            () =>
              resolve({
                ok: true,
                json: () => Promise.resolve({ success: true }),
              } as any),
            50
          );

          if (options && options.signal) {
            options.signal.addEventListener("abort", () => {
              clearTimeout(timer);
              const abortErr = new Error("Aborted");
              (abortErr as any).name = "AbortError";
              reject(abortErr);
            });
          }
        })
    );

    useFetch(url, { timeout: 10 }).onComplete((result) => {
      try {
        expect(result.isError).toBe(true);
        expect(result.isCanceled).toBe(false);
        expect((result.error as Error).message).toContain(
          "timeout of 10ms exceeded"
        );
        done();
      } catch (e) {
        done(e);
      } finally {
        global.fetch = originalFetch as any;
      }
    });
  });

  it("should NOT fetch automatically if enabled is false", async () => {
    const fetcher = jest.fn(async () => {
      await delay(10);
      return "data";
    });

    const query = useFetch(fetcher, { enabled: false });

    // Wait a bit to ensure it doesn't start
    await delay(20);
    expect(fetcher).not.toHaveBeenCalled();

    // Now execute
    query.execute();
    await delay(20);
    expect(fetcher).toHaveBeenCalled();
  });

  it("should successfully fetch data from a function endpoint", (done) => {
    const mockData = { id: 1, title: "Test Todo" };
    const fetcher = async () => {
      await delay(10);
      return mockData;
    };

    useFetch(fetcher).onComplete((result) => {
      try {
        expect(result.isSuccess).toBe(true);
        expect(result.data).toEqual(mockData);
        expect(result.error).toBeNull();
        expect(result.isLoading).toBe(false);
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  it("should successfully fetch data from a string endpoint", (done) => {
    const url = "https://jsonplaceholder.typicode.com/todos/1";

    useFetch(url).onComplete((result) => {
      try {
        expect(result.isSuccess).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.data).toMatchObject({
          id: 1,
          // title might change, but usually 'delectus aut autem'
          userId: 1,
        });
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  it("should NOT deduplicate requests when using standalone useFetch", () => {
    const url = "https://api.example.com/no-dedup";

    // Mock fetch with delay
    // @ts-ignore
    global.fetch = jest.fn(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: true,
                json: () => Promise.resolve({ success: true }),
              } as any),
            50
          )
        )
    );

    // Call twice
    const q1 = useFetch(url);
    const q2 = useFetch(url);

    expect(q1).not.toBe(q2); // Different instances

    // Check fetch calls
    // Since useFetch defaults to enabled: true, both start immediately.
    // We expect 2 calls.
    expect(global.fetch).toHaveBeenCalledTimes(2);

    // Clean up
    q1.cancel();
    q2.cancel();
  });

  it("should deduplicate execution when calling execute() on the SAME instance", () => {
    const url = "https://api.example.com/same-instance-dedup";

    // @ts-ignore
    global.fetch = jest.fn(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: true,
                json: () => Promise.resolve({ success: true }),
              } as any),
            50
          )
        )
    );

    // Created and started (default enabled: true)
    const q1 = useFetch(url);

    // Call execute again immediately
    q1.execute();
    q1.execute();

    // Should still be only 1 call
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("should deduplicate execution when calling execute() multiple times (enabled: false)", () => {
    const url = "https://api.example.com/manual-instance-dedup";

    // @ts-ignore
    global.fetch = jest.fn(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: true,
                json: () => Promise.resolve({ success: true }),
              } as any),
            50
          )
        )
    );

    // Created disabled (not started)
    const q1 = useFetch(url, { enabled: false });
    expect(global.fetch).not.toHaveBeenCalled();

    // Start manual
    q1.execute();

    // Call execute again immediately
    q1.execute();
    q1.execute();

    // Should be only 1 call
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
