import type { TRPCClient, TRPCClientErrorLike } from "@trpc/client";
import { Fetcher, FetcherDefinition } from "../core/types";

// Infer the tRPC client error type when a tRPC proxy client is provided.
// Falls back to `unknown` for generic callers.
type InferTrpcAdapterError<TCaller> = TCaller extends TRPCClient<infer TRouter>
  ? TRPCClientErrorLike<TRouter>
  : unknown;

/**
 * Stable serialization for cache keys.
 * Supports: Objects (sorted keys), Arrays, Map, Set, BigInt, Date, primitives.
 */
function stableStringify(value: any): string {
  if (value === undefined) return "";
  if (value === null) return "null";

  // Primitives
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return String(value);
  if (typeof value === "bigint") return `${value}n`;

  // Date
  if (value instanceof Date) return `Date(${value.toISOString()})`;

  // Map - convert to sorted array of entries
  if (value instanceof Map) {
    const entries = Array.from(value.entries())
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
      .map(([k, v]) => [stableStringify(k), stableStringify(v)]);
    return `Map(${JSON.stringify(entries)})`;
  }

  // Set - convert to sorted array
  if (value instanceof Set) {
    const values = Array.from(value).map(stableStringify).sort();
    return `Set(${JSON.stringify(values)})`;
  }

  // Array
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }

  // Plain object - sort keys
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    const pairs = keys.map(
      (k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`
    );
    return "{" + pairs.join(",") + "}";
  }

  // Fallback
  return JSON.stringify(value);
}

// Helper to serialize input for the key
const serializeInput = (input: any): string => {
  if (input === undefined) return "";
  return stableStringify(input);
};

/**
 * Create a tRPC-style fetcher adapter from a tRPC router or caller object.
 *
 * The returned proxy will mirror the shape of the router and convert calls
 * into `FetcherDefinition` objects `{ key, fn }` where `key` is a stable
 * string suitable for deduplication and `fn` is a fetcher that invokes the
 * original tRPC method.
 */
export function createTrpcFetcher<
  TRouter extends Record<string, any>,
  TError = InferTrpcAdapterError<TRouter>
>(routerOrCaller: TRouter): TrpcAdapter<TRouter, TError> {
  return createRecursiveProxy<TRouter, TError>(routerOrCaller, []);
}

function createRecursiveProxy<TTarget extends object, TError>(
  target: TTarget,
  path: string[]
) {
  return new Proxy(target, {
    get(t, prop, r) {
      const val = Reflect.get(t, prop, r);
      const currentPath = [...path, prop as string];

      if (typeof val === "function") {
        return new Proxy(val, {
          apply(applyTarget, thisArg, args) {
            const input = args[0];
            const queryKey = [...currentPath, serializeInput(input)]
              .filter(Boolean)
              .join(".");

            const fn: Fetcher<any, TError> = (_ctx) =>
              (applyTarget as unknown as Function).apply(thisArg, args);

            return {
              key: queryKey,
              fn,
            } as FetcherDefinition<any, TError>;
          },
        });
      }

      if (typeof val === "object" && val !== null) {
        return createRecursiveProxy(val, currentPath);
      }

      return val;
    },
  }) as TrpcAdapter<TTarget, TError>;
}

// Mapped type to transform router/caller:
// Functions returning Promise<T> become Functions returning FetcherDefinition<T>
/**
 * Type-level mapping from a tRPC router/caller to an adapter shape suitable
 * for `useFetch`. Methods that return `Promise<T>` become functions returning
 * `FetcherDefinition<T>`; nested objects are mapped recursively.
 */
export type TrpcAdapter<T, TError = unknown> = {
  [K in keyof T]: T[K] extends (...args: infer Args) => Promise<infer R>
    ? (...args: Args) => FetcherDefinition<R, TError>
    : T[K] extends object
    ? TrpcAdapter<T[K], TError>
    : T[K];
};

// Cleaner export that uses the recursive one from start
/**
 * Helper wrapper identical to `createTrpcFetcher` kept as a clearer name for
 * tRPC adapters. It returns a proxied object where each call produces a
 * `FetcherDefinition` that can be passed to `useFetch`.
 */
export function createTrpcAdapter<
  TCaller extends object,
  TError = InferTrpcAdapterError<TCaller>
>(caller: TCaller): TrpcAdapter<TCaller, TError> {
  return createRecursiveProxy<TCaller, TError>(caller, []);
}
