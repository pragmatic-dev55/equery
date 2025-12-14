export interface QueryConfig {
  enabled?: boolean;
  baseUrl?: string;
  queryKey?: string;
  // Add more config options as needed (e.g., retries, cacheTime - specifically excluded for now but good to keep in mind)
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface QueryResult<TData, TError> {
  data: TData | null;
  error: TError | null;
  isSuccess: boolean;
  isError: boolean;
  isCanceled: boolean;
  isLoading: boolean;
}

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

export type FetchContext = { signal: AbortSignal };
export type Fetcher<TData, TError = any> = (
  context: FetchContext
) => Promise<TData> | TData;

export type FetcherDefinition<TData, TError = any> = {
  key: string;
  fn: Fetcher<TData, TError>;
};

export interface Query<TData, TError> extends ExecutionChain<TData, TError> {
  execute(): Query<TData, TError>;
  /** Returns a unique identifier for the underlying query. Used for testing deduplication. */
  getQueryId(): symbol;
  /** For testing: returns the number of observer's own callbacks */
  getObserverCallbackCount(): number;
  /** For testing: returns the number of callbacks on the underlying ActiveQuery */
  getActiveQueryCallbackCount(): number;
}
