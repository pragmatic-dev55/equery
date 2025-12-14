import { initTRPC } from "@trpc/server";
import { useFetch, EqueryClient, createTrpcAdapter } from "../src/index";
import { getTRPCErrorClass, normalizeTrpcError } from "./utils/trpcErrorHelper";

const t = initTRPC.create();

describe("EqueryClient + tRPC errors", () => {
  it("client should surface tRPC/TRPC-like error from fetcher", (done) => {
    const client = new EqueryClient();

    // Build a router that throws a TRPCError-like object
    const router = t.router({
      fail: t.procedure.query(() => {
        // If real TRPCError class is available, throw it; otherwise throw an Error with `code` prop
        const TRPCErrorClass = getTRPCErrorClass();
        if (TRPCErrorClass) {
          throw new TRPCErrorClass({
            code: "FORBIDDEN",
            message: "Forbidden by tRPC",
          });
        }
        const e: any = new Error("Forbidden by tRPC");
        e.code = "FORBIDDEN";
        throw e;
      }),
    });

    const caller = router.createCaller({});

    const fetcher = async () => caller.fail();

    const q = client.useFetch(fetcher);

    q.onComplete((res) => {
      try {
        expect(res.isError).toBe(true);
        expect(res.error).toBeDefined();
        const normalized = normalizeTrpcError(res.error);
        expect(normalized.message).toBe("Forbidden by tRPC");
        // Accept either original code or tRPC wrapper code
        expect(["FORBIDDEN", "INTERNAL_SERVER_ERROR"]).toContain(
          normalized.code
        );
        done();
      } catch (err) {
        done(err);
      }
    });
  });

  it("client + createTrpcAdapter should surface errors from adapter fetchers", (done) => {
    const client = new EqueryClient();

    // Mock caller that throws TRPCError or TRPC-like error
    const mockCaller: any = {
      fail: () => {
        const TRPCErrorClass = getTRPCErrorClass();
        if (TRPCErrorClass) {
          throw new TRPCErrorClass({
            code: "UNAUTHORIZED",
            message: "Adapter Unauthorized",
          });
        }
        const e: any = new Error("Adapter Unauthorized");
        e.code = "UNAUTHORIZED";
        throw e;
      },
    };

    const trpc = createTrpcAdapter(mockCaller as any);

    const fetcher = trpc.fail();

    const q = client.useFetch(fetcher);

    let finished = false;
    q.onComplete((res) => {
      if (finished) return;
      finished = true;
      try {
        expect(res.isError).toBe(true);
        const normalized = normalizeTrpcError(res.error);
        expect(normalized.message).toBe("Adapter Unauthorized");
        expect(["UNAUTHORIZED", "INTERNAL_SERVER_ERROR"]).toContain(
          normalized.code
        );
        done();
      } catch (err) {
        done(err);
      }
    });
  });

  it("client + createTrpcAdapter with real tRPC caller should surface errors", (done) => {
    const client = new EqueryClient();

    // Create a real tRPC router that throws
    const router = t.router({
      fail: t.procedure.query(() => {
        const TRPCErrorClass = getTRPCErrorClass();
        if (TRPCErrorClass) {
          throw new TRPCErrorClass({
            code: "BAD_REQUEST",
            message: "Real Adapter Bad Request",
          });
        }
        const e: any = new Error("Real Adapter Bad Request");
        e.code = "BAD_REQUEST";
        throw e;
      }),
    });

    const caller = router.createCaller({});
    const trpc = createTrpcAdapter(caller);
    const fetcher = trpc.fail();

    const q = client.useFetch(fetcher);

    let finished = false;
    q.onComplete((res) => {
      if (finished) return;
      finished = true;
      try {
        expect(res.isError).toBe(true);
        const normalized = normalizeTrpcError(res.error);
        expect(normalized.message).toBe("Real Adapter Bad Request");
        expect(["BAD_REQUEST", "INTERNAL_SERVER_ERROR"]).toContain(
          normalized.code
        );
        done();
      } catch (err) {
        done(err);
      }
    });
  });
});
