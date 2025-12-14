import {
  Query,
  QueryConfig,
  ExecutionChain,
  QueryResult,
  Fetcher,
  FetchContext,
  FetcherDefinition,
} from "./types";

// Helper to safely detect AbortError on unknown thrown values
function isAbortError(err: unknown): boolean {
  return !!(
    err &&
    typeof err === "object" &&
    (err as any).name === "AbortError"
  );
}

/**
 * Internal representation of a running query.
 *
 * - Manages a single execution, its AbortController, and callback lists.
 * - Keeps a reference count so multiple observers can share the same underlying
 *   execution (used for deduplication).
 * - Exposes minimal helpers used by `QueryObserver` and `EqueryClient`.
 */
class ActiveQuery<TData, TError> {
  public resultState: QueryResult<TData, TError>;
  private completeCallbacks: ((result: QueryResult<TData, TError>) => void)[] =
    [];
  private errorCallbacks: ((error: TError) => void)[] = [];
  private abortController: AbortController | null = null;
  private promise: Promise<QueryResult<TData, TError>> | null = null;
  private refCount = 0;
  /** Unique identifier for this query instance */
  public readonly id = Symbol("ActiveQuery");

  constructor(
    public endpoint: string | Fetcher<TData, TError>,
    public config: QueryConfig
  ) {
    this.resultState = {
      data: null,
      error: null,
      isSuccess: false,
      isError: false,
      isCanceled: false,
      isLoading: false,
    };

    if (config.enabled !== false) {
      this.execute();
    }
  }

  addRef() {
    this.refCount++;
  }

  removeRef() {
    this.refCount--;
    if (this.refCount <= 0) {
      this.hardCancel();
    }
  }

  execute(): ActiveQuery<TData, TError> {
    if (this.resultState.isLoading && this.promise) {
      return this;
    }

    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const timeoutMs = this.config.timeout;
    const hasTimeout = typeof timeoutMs === "number" && timeoutMs > 0;
    let didTimeout = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let timeoutError: Error | null = null;

    if (hasTimeout) {
      timeoutError = new Error(`timeout of ${timeoutMs}ms exceeded`);
      timeoutId = setTimeout(() => {
        didTimeout = true;
        this.abortController?.abort();
      }, timeoutMs);
    }

    this.resultState = {
      ...this.resultState,
      isLoading: true,
      isCanceled: false,
    };

    this.promise = (async () => {
      try {
        let data: TData;

        if (typeof this.endpoint === "function") {
          data = await this.endpoint({ signal });
        } else {
          // Auto-add Content-Type for JSON body
          const headers: Record<string, string> = {
            ...(this.config.headers || {}),
          };
          if (this.config.body && !headers["Content-Type"]) {
            headers["Content-Type"] = "application/json";
          }

          const fetchImpl =
            (this.config && this.config.fetch) || (globalThis as any).fetch;
          const response = await fetchImpl(this.endpoint, {
            method: this.config.method || "GET",
            headers,
            body: this.config.body
              ? JSON.stringify(this.config.body)
              : undefined,
            signal,
          });

          if (!response.ok) {
            throw new Error(`request failed with status ${response.status}`);
          }
          data = await response.json();
        }

        if (timeoutId) clearTimeout(timeoutId);

        if (signal.aborted) {
          if (didTimeout && timeoutError) {
            throw timeoutError;
          }
          throw new Error("Aborted");
        }

        this.resultState = {
          ...this.resultState,
          data,
          isSuccess: true,
          isLoading: false,
        };

        this.notifyComplete();
        return this.resultState;
      } catch (err: unknown) {
        if (timeoutId) clearTimeout(timeoutId);
        this.resultState = { ...this.resultState, isLoading: false };

        if (didTimeout && timeoutError) {
          this.resultState.isError = true;
          this.resultState.error = timeoutError as TError;
          this.notifyError(timeoutError as TError);
        } else if (isAbortError(err) || signal.aborted) {
          this.resultState.isCanceled = true;
        } else {
          this.resultState.isError = true;
          this.resultState.error = err as TError;
          this.notifyError(err as TError);
        }

        this.notifyComplete();
        return this.resultState;
      }
    })();

    return this;
  }

  private hardCancel(): void {
    if (this.resultState.isLoading && this.abortController) {
      this.abortController.abort();
    }
  }

  onComplete(callback: (result: QueryResult<TData, TError>) => void) {
    this.completeCallbacks.push(callback);
    if (
      !this.resultState.isLoading &&
      (this.resultState.isSuccess ||
        this.resultState.isError ||
        this.resultState.isCanceled)
    ) {
      Promise.resolve().then(() => callback(this.resultState));
    }
  }

  onError(callback: (error: TError) => void) {
    this.errorCallbacks.push(callback);
    if (
      !this.resultState.isLoading &&
      this.resultState.isError &&
      this.resultState.error
    ) {
      const err = this.resultState.error;
      Promise.resolve().then(() => callback(err));
    }
  }

  private notifyComplete() {
    this.completeCallbacks.forEach((cb) => cb(this.resultState));
    // Clear callbacks to prevent memory leak
    this.completeCallbacks = [];
    this.errorCallbacks = [];
  }

  private notifyError(err: TError) {
    this.errorCallbacks.forEach((cb) => cb(err));
  }

  getPromise() {
    return this.promise;
  }

  /** For testing: returns the number of registered callbacks */
  getCallbackCount(): number {
    return this.completeCallbacks.length + this.errorCallbacks.length;
  }
}

/**
 * Observer wrapper returned to callers.
 *
 * - Wraps an `ActiveQuery` and provides the chainable API (`onComplete`,
 *   `onError`, `then`, `catch`, `finally`, `cancel`).
 * - Each observer maintains its own callback lists and can cancel itself
 *   without necessarily aborting the underlying `ActiveQuery` until all
 *   observers are removed.
 */
export class QueryObserver<TData, TError> implements Query<TData, TError> {
  private isObserverCanceled = false;
  private wrappedCompleteCallbacks: ((
    result: QueryResult<TData, TError>
  ) => void)[] = [];
  private wrappedErrorCallbacks: ((error: TError) => void)[] = [];

  constructor(public activeQuery: ActiveQuery<TData, TError>) {
    this.activeQuery.addRef();

    // Attach listener to activeQuery ONCE or per callback?
    // Better to attach a listener that fans out, OR just wrap user callbacks.
    // But if we want to synthesize, we need to handle the synthesis.
    // Let's rely on wrapping user callbacks in onComplete/onError.

    // But we ALSO need to handle the case where activeQuery completes normally:
    this.activeQuery.onComplete((res) => {
      if (!this.isObserverCanceled) {
        // Forward result
        this.wrappedCompleteCallbacks.forEach((cb) => cb(res));
      }
    });
    this.activeQuery.onError((err) => {
      if (!this.isObserverCanceled) {
        this.wrappedErrorCallbacks.forEach((cb) => cb(err));
      }
    });
  }

  execute(): Query<TData, TError> {
    this.activeQuery.execute();
    return this;
  }

  onComplete(
    callback: (result: QueryResult<TData, TError>) => void
  ): Query<TData, TError> {
    this.wrappedCompleteCallbacks.push(callback);
    // If already completed?
    if (
      this.activeQuery.resultState.isLoading === false &&
      !this.isObserverCanceled
    ) {
      // Check if activeQuery finished
      const state = this.activeQuery.resultState;
      if (state.isSuccess || state.isError || state.isCanceled) {
        Promise.resolve().then(() => callback(state));
      }
    }
    return this;
  }

  onError(callback: (error: TError) => void): Query<TData, TError> {
    this.wrappedErrorCallbacks.push(callback);
    if (
      this.activeQuery.resultState.isLoading === false &&
      !this.isObserverCanceled
    ) {
      const state = this.activeQuery.resultState;
      if (state.isError && state.error) {
        Promise.resolve().then(() => callback(state.error!));
      }
    }
    return this;
  }

  cancel(): void {
    if (this.isObserverCanceled) return;
    this.isObserverCanceled = true;
    this.activeQuery.removeRef();

    // Synthesize Cancelled Result for this observer
    const canceledState: QueryResult<TData, TError> = {
      data: null,
      error: null,
      isSuccess: false,
      isError: false,
      isCanceled: true,
      isLoading: false,
    };

    // Notify callbacks immediately (async), then clear to prevent memory leak
    const callbacks = this.wrappedCompleteCallbacks;
    this.wrappedCompleteCallbacks = [];
    this.wrappedErrorCallbacks = [];
    Promise.resolve().then(() => {
      callbacks.forEach((cb) => cb(canceledState));
    });
  }

  then<TResult1 = TData, TResult2 = never>(
    onfulfilled?:
      | ((
          value: QueryResult<TData, TError>
        ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    const p = this.activeQuery.getPromise();
    if (!p) return Promise.reject(new Error("Query has not been executed"));

    // Wrap promise to intercept result
    const wrapped = p.then(
      (res) => {
        if (this.isObserverCanceled) {
          return {
            data: null,
            error: null,
            isSuccess: false,
            isError: false,
            isCanceled: true,
            isLoading: false,
          } as QueryResult<TData, TError>;
        }
        return res;
      },
      (err) => {
        if (this.isObserverCanceled) {
          // Should we convert error to cancel? usually cancel is treated as success-path with flag or error.
          // equery treats it as resolved path with isCanceled: true
          return {
            data: null,
            error: null,
            isSuccess: false,
            isError: false,
            isCanceled: true,
            isLoading: false,
          } as QueryResult<TData, TError>;
        }
        throw err;
      }
    );

    return wrapped.then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null
  ): Promise<TData | TResult> {
    const p = this.activeQuery.getPromise();
    if (!p) return Promise.reject(new Error("Query has not been executed"));

    // We can't easily intercept catch without reimplementing logic, but calling then(null, onrejected) on wrapped works
    return this.then(null, onrejected as any) as any;
  }

  finally(onfinally?: (() => void) | null): Promise<TData> {
    const p = this.activeQuery.getPromise();
    if (!p) return Promise.reject(new Error("Query has not been executed"));
    // This is harder to wrap perfectly with types, but generally:
    return this.then(
      (res) => res.data as TData,
      (err) => {
        throw err;
      }
    ).finally(onfinally);
  }

  /** Returns a unique identifier for the underlying query. Used for testing deduplication. */
  getQueryId(): symbol {
    return this.activeQuery.id;
  }

  /** For testing: returns the number of observer's own callbacks */
  getObserverCallbackCount(): number {
    return (
      this.wrappedCompleteCallbacks.length + this.wrappedErrorCallbacks.length
    );
  }

  /** For testing: returns the number of callbacks on the underlying ActiveQuery */
  getActiveQueryCallbackCount(): number {
    return this.activeQuery.getCallbackCount();
  }
}

// Export ActiveQuery for use in Client
export { ActiveQuery };

/**
 * Convenience helper to create a `Query` from an endpoint.
 *
 * Accepts a string endpoint (which will use `fetch`), a `Fetcher` function,
 * or a `FetcherDefinition` (providing a key + fn). Returns a `QueryObserver`
 * that implements the chainable `Query` API.
 */
export function useFetch<TData = any, TError = any>(
  endpoint: string,
  config?: QueryConfig
): Query<TData, TError>;
export function useFetch<TData, TError = any>(
  endpoint: Fetcher<TData, TError>,
  config?: QueryConfig
): Query<TData, TError>;
export function useFetch<TData, TError = any>(
  endpoint: FetcherDefinition<TData, TError>,
  config?: QueryConfig
): Query<TData, TError>;
export function useFetch<TData, TError = any>(
  endpoint: string | Fetcher<TData, TError> | FetcherDefinition<TData, TError>,
  config?: QueryConfig
): Query<TData, TError> {
  let actualEndpoint: string | Fetcher<TData, TError>;

  // Unwrap FetcherDefinition if needed
  if (typeof endpoint === "object" && endpoint !== null && "fn" in endpoint) {
    actualEndpoint = (endpoint as FetcherDefinition<TData, TError>).fn;
  } else {
    actualEndpoint = endpoint as string | Fetcher<TData, TError>;
  }

  const activeQuery = new ActiveQuery<TData, TError>(
    actualEndpoint,
    config || {}
  );
  return new QueryObserver(activeQuery);
}
