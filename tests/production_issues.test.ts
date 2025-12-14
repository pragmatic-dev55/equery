import { EqueryClient, useFetch } from '../src/index';
import { mockFetch } from './test-utils';

describe('Production Issues', () => {
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    describe('Issue 1: Memory Leak - Callbacks accumulate', () => {
        it('should not accumulate callbacks after query completes', async () => {
            const client = new EqueryClient();
            const fetcher = jest.fn(async () => {
                await delay(10);
                return 'data';
            });

            const q1 = client.useFetch({ key: 'mem-leak-test', fn: fetcher });
            const q2 = client.useFetch({ key: 'mem-leak-test', fn: fetcher });
            const q3 = client.useFetch({ key: 'mem-leak-test', fn: fetcher });

            // All three share the same ActiveQuery
            expect(q1.getQueryId()).toBe(q2.getQueryId());
            expect(q2.getQueryId()).toBe(q3.getQueryId());

            // Each observer adds callbacks
            let callCount = 0;
            q1.onComplete(() => callCount++);
            q2.onComplete(() => callCount++);
            q3.onComplete(() => callCount++);

            await q1;

            // Each observer's callback should fire exactly once
            expect(callCount).toBe(3);

            // After completion, callbacks should be cleared from ActiveQuery
            expect(q1.getActiveQueryCallbackCount()).toBe(0);
        });
    });

    describe('Issue 2: Double Callback on Late Subscription', () => {
        it('should invoke late subscriber callback exactly once', async () => {
            const fetcher = async () => {
                await delay(10);
                return 'data';
            };

            const query = useFetch(fetcher);
            await query; // Wait for completion

            let callCount = 0;
            query.onComplete(() => callCount++);

            // Wait for async callback delivery
            await delay(10);

            // Should be called exactly once, not twice
            expect(callCount).toBe(1);
        });
    });

    describe('Issue 4: Cancelled Observer Memory Leak', () => {
        it('should clear callbacks when observer is cancelled', async () => {
            const client = new EqueryClient();
            const fetcher = jest.fn(async () => {
                await delay(100);
                return 'data';
            });

            const query = client.useFetch({ key: 'cancel-leak', fn: fetcher });

            query.onComplete(() => { /* callback */ });

            // Cancel immediately
            query.cancel();

            // Callbacks should be cleared
            expect(query.getObserverCallbackCount()).toBe(0);
        });
    });

    describe('Issue 5: Missing Content-Type Header', () => {
        it('should auto-add Content-Type header for POST with body', async () => {
            const mock = mockFetch({ success: true });

            const client = new EqueryClient();
            const query = client.useFetch('/api/data', {
                method: 'POST',
                body: { name: 'test' }
            });

            await query;

            expect(mock).toHaveBeenCalledWith(
                '/api/data',
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'Content-Type': 'application/json'
                    })
                })
            );
        });
    });
});
