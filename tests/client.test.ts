import { EqueryClient } from "../src/index";

describe("EqueryClient", () => {
  it("should abort and error when request exceeds timeout", (done) => {
    const client = new EqueryClient({ timeout: 20 });
    const url = "https://api.example.com/timeout";

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

    client.useFetch(url).onComplete((result) => {
      try {
        expect(result.isError).toBe(true);
        expect(result.isCanceled).toBe(false);
        expect((result.error as Error).message).toContain(
          "timeout of 20ms exceeded"
        );
        done();
      } catch (e) {
        done(e);
      } finally {
        global.fetch = originalFetch as any;
      }
    });
  });

  it("should use headers from client config", (done) => {
    const token = "Bearer my-token";
    const client = new EqueryClient({
      headers: { Authorization: token },
    });

    const mockData = { id: 1 };
    const url = "https://api.example.com/data";

    // @ts-ignore
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockData),
      })
    );

    client.useFetch(url).onComplete((result) => {
      try {
        expect(global.fetch).toHaveBeenCalledWith(
          url,
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: token,
            }),
          })
        );
        expect(result.data).toEqual(mockData);
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  it("should merge client headers with request headers", (done) => {
    const client = new EqueryClient({
      headers: { "X-Client-Id": "123" },
    });

    const url = "https://api.example.com/data";
    // @ts-ignore
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    );

    client
      .useFetch(url, { headers: { "X-Request-Id": "abc" } })
      .onComplete(() => {
        try {
          expect(global.fetch).toHaveBeenCalledWith(
            url,
            expect.objectContaining({
              headers: expect.objectContaining({
                "X-Client-Id": "123",
                "X-Request-Id": "abc",
              }),
            })
          );
          done();
        } catch (e) {
          done(e);
        }
      });
  });

  it("should prepend baseUrl to string endpoints", (done) => {
    const client = new EqueryClient({
      baseUrl: "https://api.example.com",
    });

    const endpoint = "/users";
    const expectedUrl = "https://api.example.com/users";

    // @ts-ignore
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    );

    client.useFetch(endpoint).onComplete(() => {
      try {
        expect(global.fetch).toHaveBeenCalledWith(
          expectedUrl,
          expect.anything()
        );
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  it("should deduplicate requests to the same endpoint", () => {
    const client = new EqueryClient();
    const url = "https://api.example.com/dedup";

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
            100
          )
        )
    );

    const query1 = client.useFetch(url);
    const query2 = client.useFetch(url);

    expect(query1.getQueryId()).toBe(query2.getQueryId());
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Ensure it removed from cache after completion
    return new Promise<void>((resolve, reject) => {
      query1.onComplete(() => {
        try {
          // Start new one
          const query3 = client.useFetch(url);
          expect(query3.getQueryId()).not.toBe(query1.getQueryId());
          expect(global.fetch).toHaveBeenCalledTimes(2);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });

  it("should allow overriding deduplication key to force multiple requests", () => {
    const client = new EqueryClient();
    const url = "https://api.example.com/dedup-override";

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

    // Same URL, different keys => Should be 2 requests
    const query1 = client.useFetch(url, { queryKey: "req1" });
    const query2 = client.useFetch(url, { queryKey: "req2" });

    expect(query1.getQueryId()).not.toBe(query2.getQueryId());
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("should deduplicate requests using enabled: false and .execute() pattern", () => {
    const client = new EqueryClient();
    const url = "https://api.example.com/manual-dedup";

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

    // 1. Create disabled query
    const q1 = client.useFetch(url, { enabled: false });

    // 2. Start it manually
    const runningQ1 = q1.execute();

    // 3. Create enabled query to same URL (should reuse q1)
    const q2 = client.useFetch(url); // defaults enabled: true

    // q2 should reuse the same activeQuery (deduplication works)
    expect(q2.getQueryId()).toBe(q1.getQueryId());
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Verify q1 actually finishes
    return new Promise<void>((resolve) => {
      q2.onComplete(() => {
        resolve();
      });
    });
  });

  it("should deduplicate when BOTH queries are enabled: false and manually executed", () => {
    const client = new EqueryClient();
    const url = "https://api.example.com/double-manual-dedup";

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

    // 1. Create first disabled query
    const q1 = client.useFetch(url, { enabled: false });

    // 2. Start it
    q1.execute();

    // 3. Create second disabled query
    const q2 = client.useFetch(url, { enabled: false });

    // q2 should NOT be q1 initially because enabled: false skips initial cache check
    expect(q2).not.toBe(q1);

    // 4. Start second query
    const executedQ2 = q2.execute();

    // executedQ2 should share the same activeQuery with q1 (deduplication works)
    expect(executedQ2.getQueryId()).toBe(q1.getQueryId());
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
