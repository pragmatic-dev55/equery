import { useFetch } from '../src/index';

describe('useFetch - Chaining & Error Handling', () => {
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    it('should allow chaining multiple callbacks (onComplete, onError)', (done) => {
        const fetcher = async () => 'success';
        const onCompleteSpy = jest.fn();
        const onErrorSpy = jest.fn();

        useFetch(fetcher)
            .onComplete(onCompleteSpy)
            .onError(onErrorSpy)
            .then(() => {
                expect(onCompleteSpy).toHaveBeenCalled();
                expect(onErrorSpy).not.toHaveBeenCalled();
                done();
            });
    });

    it('should handle errors correctly', (done) => {
        const errorMsg = 'Network Error';
        const fetcher = async () => {
            await delay(10);
            throw new Error(errorMsg);
        };

        useFetch(fetcher)
            .onComplete((result) => {
                try {
                    expect(result.isSuccess).toBe(false);
                    expect(result.isError).toBe(true);
                    expect(result.error).toBeInstanceOf(Error);
                    expect((result.error as Error).message).toBe(errorMsg);
                    done();
                } catch (e) {
                    done(e);
                }
            });
    });
});
