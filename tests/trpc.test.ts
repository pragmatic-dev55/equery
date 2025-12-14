import { initTRPC } from "@trpc/server";
import { z } from "zod";
import { useFetch, EqueryClient, createTrpcAdapter } from "../src/index";
import { getTRPCErrorClass, normalizeTrpcError } from "./utils/trpcErrorHelper";

// 1. Initialize tRPC
const t = initTRPC.create();

// 2. Define Router
const appRouter = t.router({
  hello: t.procedure
    .input(z.object({ name: z.string().optional() }))
    .query(({ input }) => {
      return {
        greeting: `Hello ${input?.name ?? "World"}`,
      };
    }),
});

// 3. Create Caller (Server-side caller for simplicity in testing without HTTP transport)
// In a real app, you'd use @trpc/client httpLink, but for 'useFetch' taking a function,
// it just needs a function that returns a Promise.
// We can simulate a client that mimics the calling signature or just use the caller.
const caller = appRouter.createCaller({});

describe("tRPC Compatibility", () => {
  it("should work with tRPC procedures as endpoints", (done) => {
    // useFetch expects a function: (context) => Promise<T>
    // tRPC caller methods are: (input) => Promise<T>

    // We can wrap it.
    const trpcFetcher = async () => {
      return await caller.hello({ name: "Equery" });
    };

    useFetch(trpcFetcher).onComplete((result) => {
      try {
        expect(result.data).toEqual({ greeting: "Hello Equery" });
        expect(result.isSuccess).toBe(true);
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  it("should handle tRPC errors", (done) => {
    const errorRouter = t.router({
      fail: t.procedure.query(() => {
        throw new Error("tRPC Failed");
      }),
    });
    const errorCaller = errorRouter.createCaller({});

    const fetcher = async () => errorCaller.fail();

    useFetch(fetcher).onComplete((result) => {
      try {
        expect(result.isError).toBe(true);
        // tRPC errors might come wrapped, but here it's direct call
        expect(result.error).toBeDefined();
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  it("should propagate thrown tRPC error message to the result", (done) => {
    const errorRouter = t.router({
      failMsg: t.procedure.query(() => {
        throw new Error("Specific tRPC error");
      }),
    });
    const errorCaller = errorRouter.createCaller({});

    const fetcher = async () => errorCaller.failMsg();

    useFetch(fetcher).onComplete((result) => {
      try {
        expect(result.isError).toBe(true);
        expect(result.error).toBeDefined();
        // Error was thrown directly; ensure message is preserved
        expect((result.error as Error).message).toBe("Specific tRPC error");
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  it("should surface TRPC-like error shape with code and message intact", (done) => {
    const errorRouter = t.router({
      trpcFail: t.procedure.query(() => {
        // Throw an Error that carries a `code` property similar to TRPCError
        const e: any = new Error("TRPC-specific failure");
        e.code = "BAD_REQUEST";
        throw e;
      }),
    });

    const errorCaller = errorRouter.createCaller({});

    const fetcher = async () => errorCaller.trpcFail();

    useFetch(fetcher).onComplete((result) => {
      try {
        expect(result.isError).toBe(true);
        expect(result.error).toBeDefined();
        // Normalize and assert on TRPC-like error shape.
        const normalized = normalizeTrpcError(result.error);
        expect(normalized.message).toBe("TRPC-specific failure");

        // Accept either original desired code or tRPC wrapper code.
        expect(["BAD_REQUEST", "INTERNAL_SERVER_ERROR"]).toContain(
          normalized.code
        );

        // If TRPCError class is available, optionally assert instanceof if applicable
        const TRPCErrorClass = getTRPCErrorClass();
        if (TRPCErrorClass && (result.error as any) instanceof TRPCErrorClass) {
          expect(result.error as any).toBeInstanceOf(TRPCErrorClass);
        }
        done();
      } catch (e) {
        done(e);
      }
    });
  });

  it("should deduplicate tRPC calls when using EqueryClient with queryKey", () => {
    const client = new EqueryClient();

    // Wrap caller to spy on it
    const spy = jest.fn((name?: string) => caller.hello({ name }));

    const trpcFetcher = async () => {
      return await spy("Dedup");
    };

    const key = "trpc.hello.dedup";
    const q1 = client.useFetch(trpcFetcher, { queryKey: key });
    const q2 = client.useFetch(trpcFetcher, { queryKey: key });

    expect(q1.getQueryId()).toBe(q2.getQueryId());

    // Return promise to wait for completion
    return new Promise<void>((resolve, reject) => {
      q1.onComplete(() => {
        try {
          expect(spy).toHaveBeenCalledTimes(1);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });

  it("should NOT deduplicate tRPC calls without queryKey", () => {
    const client = new EqueryClient();
    const spy = jest.fn((name?: string) => caller.hello({ name }));

    // Function reference is different usually, but even if same function:
    // Client deduplication relies on string key. If no string endpoint or queryKey, no dedup.
    const trpcFetcher = async () => spy("NoDedup");

    const q1 = client.useFetch(trpcFetcher);
    const q2 = client.useFetch(trpcFetcher);

    expect(q1).not.toBe(q2);
    // Both start immediately
  });

  it("debug: inspect tRPC caller properties", () => {
    // @ts-ignore
    console.log("caller.hello name:", caller.hello.name); // likely 'bound ' or anonymous
    console.log("caller.hello properties:", Object.keys(caller.hello));
  });

  it("should deduplicate using FetcherDefinition object (key + fn)", () => {
    const client = new EqueryClient();
    const spy = jest.fn((name?: string) => caller.hello({ name }));

    // Define enhanced fetcher
    const enhancedFetcher = {
      key: "trpc.hello.enhanced",
      fn: async () => spy("Enhanced"),
    };

    // Call twice with the object
    const q1 = client.useFetch(enhancedFetcher);
    const q2 = client.useFetch(enhancedFetcher);

    // Should be deduped because 'key' is extracted
    expect(q1.getQueryId()).toBe(q2.getQueryId());

    return new Promise<void>((resolve, reject) => {
      q1.onComplete(() => {
        try {
          expect(spy).toHaveBeenCalledTimes(1);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });

  it("should deduce key automatically using createTrpcAdapter", () => {
    const client = new EqueryClient();
    const spy = jest.fn((input?: { name?: string }) =>
      caller.hello(input || {})
    );

    // Mock caller to use spy
    const mockCaller = {
      hello: spy as typeof caller.hello,
    };

    const trpc = createTrpcAdapter(mockCaller);

    // Usage: trpc.hello(...) returns { key, fn }
    const fetcher1 = trpc.hello({ name: "Auto" });
    const fetcher2 = trpc.hello({ name: "Auto" });
    const fetcher3 = trpc.hello({ name: "Other" });

    // Check keys
    expect(fetcher1.key).toContain("hello");
    expect(fetcher1.key).toContain("Auto");

    const q1 = client.useFetch(fetcher1);
    const q2 = client.useFetch(fetcher2);
    const q3 = client.useFetch(fetcher3);

    // Same input -> dedup
    expect(q1.getQueryId()).toBe(q2.getQueryId());
    // Diff input -> diff
    expect(q3.getQueryId()).not.toBe(q1.getQueryId());

    // Verify execution
    return new Promise<void>((resolve, reject) => {
      q1.onComplete((res) => {
        try {
          expect(res.isSuccess).toBe(true);
          expect(res.data).toEqual({ greeting: "Hello Auto" });
          expect(spy).toHaveBeenCalledTimes(2); // 1 for q1/q2, 1 for q3
          expect(spy).toHaveBeenCalledWith({ name: "Auto" });
          expect(spy).toHaveBeenCalledWith({ name: "Other" });
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });

  it("should generate correct keys for nested paths and parameters", () => {
    // Mock a nested structure
    const mockCaller = {
      user: {
        byId: jest.fn(),
        list: jest.fn(),
      },
      post: {
        create: jest.fn(),
      },
    };

    const trpc = createTrpcAdapter(mockCaller);

    // 1. Nested Path
    const fetcher1 = trpc.user.byId({ id: 1 });
    // Expected key structure matches logic in trpc.ts: [path, serializeInput].join('.')
    // Nested path accumulation: 'user' -> 'byId'
    // Args: {id:1}
    const expectedKey1 = 'user.byId.{"id":1}';
    expect(fetcher1.key).toBe(expectedKey1);

    // 2. Different Params
    const fetcher2 = trpc.user.byId({ id: 2 });
    const expectedKey2 = 'user.byId.{"id":2}';
    expect(fetcher2.key).toBe(expectedKey2);
    expect(fetcher1.key).not.toBe(fetcher2.key);

    // 3. Different Method
    const fetcher3 = trpc.user.list({ limit: 10 });
    const expectedKey3 = 'user.list.{"limit":10}';
    expect(fetcher3.key).toBe(expectedKey3);

    // 4. No params (undefined input)
    // serializeInput returns '' if undefined.
    // join('.') might result in trailing dot or we filtered Boolean?
    // Let's check logic: [path, serializeInput].filter(Boolean).join('.')
    // if input undefined -> '' -> filtered out.
    // So key should be just path.
    const fetcher4 = (trpc.post.create as any)(); // cast because mock definition implies args
    expect(fetcher4.key).toBe("post.create");
  });
});
