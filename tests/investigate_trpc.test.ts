import { EqueryClient, createTrpcAdapter } from '../src/index';

describe('tRPC Rich Data Serialization', () => {

    // Helper for async delay
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    it('should correctly distinguish Maps with different entries', () => {
        const caller = {
            search: jest.fn()
        };
        const trpc = createTrpcAdapter(caller);
        const client = new EqueryClient();

        // 1. Two different Maps
        const map1 = new Map([['a', 1]]);
        const map2 = new Map([['b', 2]]);

        const q1 = client.useFetch(trpc.search(map1));
        const q2 = client.useFetch(trpc.search(map2));

        // Expect separate queries
        expect(q1.getQueryId()).not.toBe(q2.getQueryId());
    });

    it('should deduplicate Maps with same entries (Key Stability)', () => {
        const caller = {
            search: jest.fn()
        };
        const trpc = createTrpcAdapter(caller);
        const client = new EqueryClient();

        // Same content, different insertion order if possible (though for Map 'AB' vs 'BA' iteration order depends)
        // Superjson should handle canonicalization or we rely on structure.
        // Actually superjson might preserve order?
        // But let's check basic equality.

        const mapA1 = new Map([['key', 'value']]);
        const mapA2 = new Map([['key', 'value']]);

        const q1 = client.useFetch(trpc.search(mapA1));
        const q2 = client.useFetch(trpc.search(mapA2));

        // Expect same query
        expect(q1.getQueryId()).toBe(q2.getQueryId());
    });

    it('should handle BigInt serialization without error', () => {
        const caller = {
            sum: jest.fn()
        };
        const trpc = createTrpcAdapter(caller);
        const client = new EqueryClient();

        expect(() => {
            const big = BigInt(12345678901234567890);
            client.useFetch(trpc.sum(big));
        }).not.toThrow();
    });

    it('should handle Date serialization', () => {
        const caller = {
            find: jest.fn()
        };
        const trpc = createTrpcAdapter(caller);
        const client = new EqueryClient();

        const d1 = new Date('2023-01-01');
        const d2 = new Date('2023-01-01');
        const d3 = new Date('2023-01-02');

        const q1 = client.useFetch(trpc.find(d1));
        const q2 = client.useFetch(trpc.find(d2));
        const q3 = client.useFetch(trpc.find(d3));

        expect(q1.getQueryId()).toBe(q2.getQueryId());
        expect(q1.getQueryId()).not.toBe(q3.getQueryId());
    });
});

describe('tRPC Transformer Passthrough', () => {

    it('should correctly pass through Date objects from transformer-enabled tRPC callers', async () => {
        // Simulate a tRPC caller that returns transformed data (like superjson would)
        const mockDate = new Date('2024-06-15T10:30:00Z');
        const caller = {
            getEvent: jest.fn().mockResolvedValue({
                id: 1,
                name: 'Conference',
                date: mockDate  // Simulating superjson deserializing the Date
            })
        };

        const trpc = createTrpcAdapter(caller);
        const client = new EqueryClient();

        const query = client.useFetch(trpc.getEvent({ id: 1 }));
        const result = await query;

        expect(result.isSuccess).toBe(true);
        const data = result.data as any;
        expect(data.date).toBe(mockDate);
        expect(data.date instanceof Date).toBe(true);
        expect(caller.getEvent).toHaveBeenCalledWith({ id: 1 });
    });

    it('should correctly pass through Map objects from transformer-enabled tRPC callers', async () => {
        // Simulate superjson deserializing a Map
        const mockMap = new Map([['users', 100], ['orders', 50]]);
        const caller = {
            getStats: jest.fn().mockResolvedValue({
                stats: mockMap
            })
        };

        const trpc = createTrpcAdapter(caller);
        const client = new EqueryClient();

        const query = client.useFetch(trpc.getStats());
        const result = await query;

        expect(result.isSuccess).toBe(true);
        const data = result.data as any;
        expect(data.stats).toBe(mockMap);
        expect(data.stats instanceof Map).toBe(true);
        expect(data.stats.get('users')).toBe(100);
    });

    it('should correctly pass through BigInt from transformer-enabled tRPC callers', async () => {
        // Simulate superjson deserializing BigInt
        const bigValue = BigInt('9007199254740993'); // Larger than Number.MAX_SAFE_INTEGER
        const caller = {
            getLargeNumber: jest.fn().mockResolvedValue({
                value: bigValue
            })
        };

        const trpc = createTrpcAdapter(caller);
        const client = new EqueryClient();

        const query = client.useFetch(trpc.getLargeNumber());
        const result = await query;

        expect(result.isSuccess).toBe(true);
        const data = result.data as any;
        expect(data.value).toBe(bigValue);
        expect(typeof data.value).toBe('bigint');
    });

    it('should correctly pass through Set objects from transformer-enabled tRPC callers', async () => {
        // Simulate superjson deserializing a Set
        const mockSet = new Set(['admin', 'user', 'guest']);
        const caller = {
            getRoles: jest.fn().mockResolvedValue({
                roles: mockSet
            })
        };

        const trpc = createTrpcAdapter(caller);
        const client = new EqueryClient();

        const query = client.useFetch(trpc.getRoles());
        const result = await query;

        expect(result.isSuccess).toBe(true);
        const data = result.data as any;
        expect(data.roles).toBe(mockSet);
        expect(data.roles instanceof Set).toBe(true);
        expect(data.roles.has('admin')).toBe(true);
    });

    it('should correctly pass input to tRPC caller (input transformation)', async () => {
        // Verify that complex inputs are passed directly to the tRPC caller
        const inputDate = new Date('2024-01-01');
        const inputMap = new Map([['filter', 'active']]);

        const caller = {
            search: jest.fn().mockResolvedValue({ results: [] })
        };

        const trpc = createTrpcAdapter(caller);
        const client = new EqueryClient();

        const query = client.useFetch(trpc.search({
            since: inputDate,
            filters: inputMap
        }));
        await query;

        // Verify the original objects were passed to the caller (not serialized)
        expect(caller.search).toHaveBeenCalledWith({
            since: inputDate,
            filters: inputMap
        });

        // Confirm they're the exact same object references
        const calledWith = caller.search.mock.calls[0][0];
        expect(calledWith.since).toBe(inputDate);
        expect(calledWith.filters).toBe(inputMap);
    });
});
