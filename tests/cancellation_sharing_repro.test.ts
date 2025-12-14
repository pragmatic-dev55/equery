import { EqueryClient } from '../src/core/Client';
import { useFetch } from '../src/core/Query';
import { QueryResult } from '../src/core/types';

describe('Shared Query Cancellation (Ref Counted)', () => {
    it('should NOT abort request if only one consumer cancels', async () => {
        const client = new EqueryClient();
        let abortSignal: AbortSignal | undefined;

        // Mock fetcher
        const fetcher = jest.fn(async ({ signal }: { signal: AbortSignal }) => {
            abortSignal = signal;
            return new Promise<string>((resolve, reject) => {
                const timer = setTimeout(() => resolve('done'), 50);
                signal.addEventListener('abort', () => {
                    clearTimeout(timer);
                    reject(new Error('Aborted'));
                });
            });
        });

        // A and B share the same key
        const queryA = client.useFetch({ key: 'shared-resource', fn: fetcher });
        const queryB = client.useFetch({ key: 'shared-resource', fn: fetcher });

        expect(queryA).not.toBe(queryB); // They should be different Observers now

        const resultBPromise = new Promise<QueryResult<string, Error>>(resolve => queryB.onComplete(resolve));

        // Cancel A
        queryA.cancel();

        // Await B (should succeed)
        const resultB = await resultBPromise;

        expect(resultB.isSuccess).toBe(true);
        expect(resultB.data).toBe('done');
        expect(abortSignal?.aborted).toBe(false); // Validating crucial fix
    });

    it('should abort request if ALL consumers cancel', async () => {
        const client = new EqueryClient();
        let abortSignal: AbortSignal | undefined;

        const fetcher = jest.fn(async ({ signal }: { signal: AbortSignal }) => {
            abortSignal = signal;
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => resolve('done'), 100);
                signal.addEventListener('abort', () => {
                    clearTimeout(timer);
                    reject(new Error('Aborted'));
                });
            });
        });

        const queryA = client.useFetch({ key: 'shared-resource-2', fn: fetcher });
        const queryB = client.useFetch({ key: 'shared-resource-2', fn: fetcher });

        // Cancel both
        queryA.cancel();
        queryB.cancel();

        // Since both cancelled, signal should be aborted. 
        // We can't await queryA/B onComplete because cancelling suppresses callbacks.
        // We check the signal state after a short delay to allow microtask propagation.

        await new Promise(r => setTimeout(r, 10));

        expect(abortSignal?.aborted).toBe(true);
    });
});
