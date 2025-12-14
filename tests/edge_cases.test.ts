import { EqueryClient, useFetch, createTrpcAdapter } from '../src/index';

describe('Edge Cases & Regression Tests', () => {

    // Helper for async delay
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    it('should invoke callbacks even if attached AFTER the query has completed (Late Subscription)', (done) => {
        const fetcher = async () => {
            await delay(10);
            return 'early-data';
        };

        const query = useFetch(fetcher);

        // Wait for it to finish
        setTimeout(() => {
            // At this point, query should be done
            query.onComplete((result) => {
                try {
                    expect(result.isSuccess).toBe(true);
                    expect(result.data).toBe('early-data');
                    done();
                } catch (e) {
                    done(e);
                }
            });
        }, 50);
    });

    it('should NOT deduplicate requests with different Method or Body (Method/Body Differentiation)', () => {
        const client = new EqueryClient();
        const url = 'https://api.example.com/resource';

        // @ts-ignore
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ success: true })
            })
        );

        // 1. GET Request
        const q1 = client.useFetch(url, { method: 'GET' });

        // 2. POST Request (same URL)
        const q2 = client.useFetch(url, {
            method: 'POST',
            body: { some: 'data' }
        });

        // Current implementation likely fails here if it only looks at URL
        expect(q1.getQueryId()).not.toBe(q2.getQueryId());

        // Should trigger 2 fetches
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should stable-sort object keys for tRPC inputs (Key Stability)', () => {
        // Mock tRPC-like structure
        const caller = {
            user: {
                find: jest.fn()
            }
        };

        const trpc = createTrpcAdapter(caller);
        const client = new EqueryClient();

        // 1. { a: 1, b: 2 }
        const q1 = client.useFetch(trpc.user.find({ a: 1, b: 2 }));

        // 2. { b: 2, a: 1 } (Same content, different order)
        const q2 = client.useFetch(trpc.user.find({ b: 2, a: 1 }));

        // Theoretically should be same query
        expect(q1.getQueryId()).toBe(q2.getQueryId());
    });
});
