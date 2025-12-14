import { QueryConfig, Query, Fetcher, FetcherDefinition } from "./types";
import {
  useFetch as standaloneUseFetch,
  ActiveQuery,
  QueryObserver,
} from "./Query";

/**
 * `EqueryClient` provides a client-scoped way to call `useFetch` with shared
 * configuration and deduplication across the client instance.
 *
 * Typical usage:
 * ```ts
 * const client = new EqueryClient({ baseUrl: 'https://api' });
 * const q = client.useFetch('/path');
 * q.onComplete(result => ...);
 * ```
 */
export class EqueryClient {
  private config: QueryConfig;
  private activeQueries = new Map<string, ActiveQuery<any, any>>();

  constructor(config: QueryConfig = {}) {
    this.config = config;
  }

  /**
   * Replace the client's configuration entirely.
   * Useful when you want to reset headers/baseUrl/etc. to a new set.
   */
  setConfig(config: QueryConfig) {
    this.config = config || {};
  }

  /**
   * Merge provided partial configuration into the existing client config.
   * Headers are merged shallowly so callers can add/remove headers.
   */
  updateConfig(partial: Partial<QueryConfig>) {
    const mergedHeaders = {
      ...(this.config.headers || {}),
      ...(partial.headers || {}),
    };

    this.config = {
      ...this.config,
      ...partial,
      headers: mergedHeaders,
    } as QueryConfig;
  }

  useFetch<TData = any, TError = any>(
    endpoint: string,
    config?: QueryConfig
  ): Query<TData, TError>;
  useFetch<TData, TError = any>(
    endpoint: Fetcher<TData, TError>,
    config?: QueryConfig
  ): Query<TData, TError>;
  useFetch<TData, TError = any>(
    endpoint: FetcherDefinition<TData, TError>,
    config?: QueryConfig
  ): Query<TData, TError>;
  useFetch<TData, TError>(
    endpoint:
      | string
      | Fetcher<TData, TError>
      | FetcherDefinition<TData, TError>,
    config: QueryConfig = {}
  ): Query<TData, TError> {
    /**
     * Client-scoped `useFetch`. Merges client config with call config and
     * performs deduplication by generating a cache key. Returns a `Query`
     * (observer) that can be used to attach callbacks or await results.
     */
    // Unwrap FetcherDefinition to extract key
    let actualEndpoint: string | Fetcher<TData>;
    let definitionKey: string | undefined;

    if (typeof endpoint === "object" && endpoint !== null && "fn" in endpoint) {
      actualEndpoint = (endpoint as FetcherDefinition<TData, TError>).fn;
      definitionKey = (endpoint as FetcherDefinition<TData, TError>).key;
    } else {
      actualEndpoint = endpoint as string | Fetcher<TData, TError>;
    }

    // Merge configs
    const mergedHeaders = {
      ...this.config.headers,
      ...config.headers,
    };

    const mergedConfig: QueryConfig = {
      ...this.config,
      ...config,
      headers: mergedHeaders,
    };

    let finalEndpoint = actualEndpoint;
    if (typeof actualEndpoint === "string" && mergedConfig.baseUrl) {
      // Avoid double slashes if both have them, or missing slash
      const base = mergedConfig.baseUrl.replace(/\/$/, "");
      const path = actualEndpoint.replace(/^\//, "");
      finalEndpoint = `${base}/${path}`;
    }

    // Deduplication Logic
    let cacheKey: string | null = null;
    if (mergedConfig.queryKey) {
      cacheKey = mergedConfig.queryKey;
    } else if (definitionKey) {
      cacheKey = definitionKey;
    } else if (typeof finalEndpoint === "string") {
      // Include method and body in key to differentiate requests
      const method = mergedConfig.method || "GET";
      const bodyStr = mergedConfig.body
        ? JSON.stringify(mergedConfig.body)
        : "";
      cacheKey = `${method}:${finalEndpoint}${bodyStr ? `:${bodyStr}` : ""}`;
    }

    // Always check cache for running queries (regardless of enabled status)
    if (cacheKey && this.activeQueries.has(cacheKey)) {
      const existingQuery = this.activeQueries.get(cacheKey)!;
      return new QueryObserver(existingQuery);
    }

    const activeQuery = new ActiveQuery<TData, TError>(
      finalEndpoint,
      mergedConfig
    );

    if (cacheKey) {
      if (mergedConfig.enabled !== false) {
        // Auto-enabled: register immediately
        this.activeQueries.set(cacheKey, activeQuery);
        activeQuery.onComplete(() => {
          this.activeQueries.delete(cacheKey as string);
        });
      } else {
        // Manual (enabled: false): register lazily on execute()
        const originalExecute = activeQuery.execute.bind(activeQuery);
        activeQuery.execute = () => {
          // Check if another query started running
          if (this.activeQueries.has(cacheKey as string)) {
            // Return existing - but we need to return the same observer's activeQuery
            // This is tricky - we already created an observer.
            // We'll just run ours but if someone else is running, don't duplicate.
            return originalExecute();
          }

          // Register in cache
          this.activeQueries.set(cacheKey as string, activeQuery);
          activeQuery.onComplete(() => {
            this.activeQueries.delete(cacheKey as string);
          });

          return originalExecute();
        };
      }
    }

    return new QueryObserver(activeQuery);
  }
}
