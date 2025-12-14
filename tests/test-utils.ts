/**
 * Test utilities for equery
 * Provides type-safe helpers for testing
 */

/**
 * Creates a mock fetch Response for testing
 */
export function createMockResponse<T>(data: T, options: { ok?: boolean; status?: number; delay?: number } = {}): Promise<Response> {
    const { ok = true, status = 200, delay = 0 } = options;

    const response = {
        ok,
        status,
        json: () => Promise.resolve(data),
        text: () => Promise.resolve(JSON.stringify(data)),
        headers: new Headers(),
        redirected: false,
        statusText: ok ? 'OK' : 'Error',
        type: 'basic' as ResponseType,
        url: '',
        clone: () => response as Response,
        body: null,
        bodyUsed: false,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        blob: () => Promise.resolve(new Blob()),
        formData: () => Promise.resolve(new FormData()),
        bytes: () => Promise.resolve(new Uint8Array()),
    } as Response;

    if (delay > 0) {
        return new Promise(resolve => setTimeout(() => resolve(response), delay));
    }
    return Promise.resolve(response);
}

/**
 * Type-safe mock for global.fetch
 */
export function mockFetch<T>(data: T, options: { ok?: boolean; status?: number; delay?: number } = {}): jest.Mock {
    const mock = jest.fn(() => createMockResponse(data, options));
    // @ts-ignore - Assigning mock to global
    global.fetch = mock;
    return mock;
}
