import { useFetch } from '../src/index';

describe('useFetch - Cancellation', () => {
    it('should handle cancellation', (done) => {
        const fetcher = async ({ signal }: { signal: AbortSignal }) => {
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => resolve('done'), 100);
                signal.addEventListener('abort', () => {
                    clearTimeout(timer);
                    reject(new Error('Aborted'));
                });
            });
        };

        const chain = useFetch(fetcher);

        chain.onComplete((result) => {
            try {
                expect(result.isCanceled).toBe(true);
                expect(result.data).toBeNull();
                done();
            } catch (e) {
                done(e);
            }
        });

        // Cancel immediately
        chain.cancel();
    });
});
