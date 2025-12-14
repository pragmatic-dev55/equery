import { initTRPC, TRPCError } from "@trpc/server";
import type { TRPCClientErrorLike } from "@trpc/client";
import { z } from "zod";
import { EqueryClient, createTrpcAdapter } from "../src/index";
import { normalizeTrpcError } from "./utils/trpcErrorHelper";

// Simple type-level helpers
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<T extends true> = T;

describe("tRPC adapter + EqueryClient end-to-end type inference", () => {
  const t = initTRPC.create();

  const appRouter = t.router({
    hello: t.procedure
      .input(z.object({ name: z.string().optional() }).optional())
      .query(({ input }) => {
        return { greeting: `Hello ${input?.name ?? "world"}` };
      }),

    increment: t.procedure
      .input(z.object({ value: z.number(), delta: z.number().default(1) }))
      .mutation(({ input }) => {
        return { next: input.value + input.delta };
      }),

    fail: t.procedure
      .input(z.object({ code: z.string().optional() }).optional())
      .query(({ input }) => {
        throw new TRPCError({
          code: (input?.code as any) || "UNAUTHORIZED",
          message: "Boom from tRPC",
        });
      }),
  });

  type AppRouter = typeof appRouter;
  type AppError = TRPCClientErrorLike<AppRouter>;

  it("infers data and error types through adapter + useFetch", async () => {
    const caller = appRouter.createCaller({});
    const trpc = createTrpcAdapter<typeof caller, AppError>(caller);
    const client = new EqueryClient();

    const helloQuery = client.useFetch(trpc.hello({ name: "Ada" }));
    const incQuery = client.useFetch(trpc.increment({ value: 2, delta: 3 }));
    const failQuery = client.useFetch(trpc.fail({ code: "FORBIDDEN" }));

    // ---- Type assertions (compile-time only) ----
    type HelloFetcher = ReturnType<typeof trpc.hello>;
    type HelloData = Awaited<ReturnType<HelloFetcher["fn"]>>;
    type HelloError =
      HelloFetcher extends import("../src/core/types").FetcherDefinition<
        any,
        infer E
      >
        ? E
        : never;

    type _HelloDataOK = Expect<Equals<HelloData, { greeting: string }>>;
    type _HelloErrorOK = Expect<Equals<HelloError, AppError>>;

    type HelloOnErrorArg = Parameters<
      Parameters<typeof helloQuery.onError>[0]
    >[0];
    type _HelloOnErrorMatches = Expect<Equals<HelloOnErrorArg, AppError>>;

    type IncResult = Parameters<Parameters<typeof incQuery.onComplete>[0]>[0];
    type _IncDataOK = Expect<
      Equals<IncResult["data"], { next: number } | null>
    >;

    // ---- Runtime assertions ----
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        helloQuery.onComplete((res) => {
          try {
            expect(res.isSuccess).toBe(true);
            expect(res.data).toEqual({ greeting: "Hello Ada" });
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      }),
      new Promise<void>((resolve, reject) => {
        incQuery.onComplete((res) => {
          try {
            expect(res.isSuccess).toBe(true);
            expect(res.data).toEqual({ next: 5 });
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      }),
      new Promise<void>((resolve, reject) => {
        failQuery.onComplete((res) => {
          try {
            expect(res.isError).toBe(true);
            expect(res.error).toBeTruthy();
            const normalized = normalizeTrpcError(res.error as any);
            expect(normalized.message).toBe("Boom from tRPC");
            expect([
              "FORBIDDEN",
              "UNAUTHORIZED",
              "BAD_REQUEST",
              "INTERNAL_SERVER_ERROR",
            ]).toContain(normalized.code);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      }),
    ]);
  });
});
