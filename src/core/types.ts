/**
 * Configuration for a query/request.
 *
 * - `enabled`: when false, the query will not auto-execute until `execute()` is called.
 * - `baseUrl`: optional base URL to prefix string endpoints.
 * - `queryKey`: optional explicit cache/deduplication key.
 * - `method`, `headers`, `body`: request options when using string endpoints.
 * - `timeout`: optional timeout in milliseconds to abort the request.
 */
export interface QueryConfig {
  enabled?: boolean;
  baseUrl?: string;
  queryKey?: string;
  // Add more config options as needed (e.g., retries, cacheTime - specifically excluded for now but good to keep in mind)
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  /** Timeout in milliseconds before the request is aborted (similar to axios). */
  timeout?: number;
}

/**
 * Result state returned by queries and observers.
 *
 * `data` and `error` are mutually exclusive in normal success/error flows.
 */
export interface QueryResult<TData, TError> {
  data: TData | null;
  error: TError | null;
  isSuccess: boolean;
  isError: boolean;
  isCanceled: boolean;
  isLoading: boolean;
}

/**
 * Minimal chainable API returned by queries/observers.
 *
 * Supports attaching lifecycle callbacks, cancellation and Promise compatibility.
 */
export interface ExecutionChain<TData, TError> {
  onComplete(
    callback: (result: QueryResult<TData, TError>) => void
  ): ExecutionChain<TData, TError>;
  onError(callback: (error: TError) => void): ExecutionChain<TData, TError>;
  cancel(): void;
  // Promise compatibility
  then<TResult1 = TData, TResult2 = never>(
    onfulfilled?:
      | ((
          value: QueryResult<TData, TError>
        ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2>;
  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null
  ): Promise<TData | TResult>;
  finally(onfinally?: (() => void) | null): Promise<TData>;
}

/** Context passed to fetcher functions. */
export type FetchContext = { signal: AbortSignal };

/**
 * A fetcher function which may use the provided `signal` for cancellation.
 * Can return either a value synchronously or a Promise resolving to the value.
 */
export type Fetcher<TData, TError = any> = (
  context: FetchContext
) => Promise<TData> | TData;

/**
 * Small wrapper used by adapters to provide both a stable cache key and the
 * fetcher function to execute.
 */
export type FetcherDefinition<TData, TError = any> = {
  key: string;
  fn: Fetcher<TData, TError>;
};

/**
 * Public-facing Query interface returned by `useFetch` and `EqueryClient.useFetch`.
 *
 * It extends `ExecutionChain` for chaining, and exposes helpers useful for
 * testing and deduplication.
 */
export interface Query<TData, TError> extends ExecutionChain<TData, TError> {
  /** Ensure the query is executed. Useful when `enabled: false` was provided. */
  execute(): Query<TData, TError>;
  /** Returns a unique identifier for the underlying query. Used for testing deduplication. */
  getQueryId(): symbol;
  /** For testing: returns the number of observer's own callbacks */
  getObserverCallbackCount(): number;
  /** For testing: returns the number of callbacks on the underlying ActiveQuery */
  getActiveQueryCallbackCount(): number;
}
