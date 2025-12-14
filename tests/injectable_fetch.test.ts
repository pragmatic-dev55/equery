import { EqueryClient } from "../src/index";

describe("EqueryClient injectable fetch", () => {
  it("should use injected fetch implementation for requests", (done) => {
    let called = false;
    const fakeFetch = jest.fn((input: any, init?: any) => {
      called = true;
      // return object shaped like Response used by ActiveQuery
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ hello: true }),
      } as any);
    });

    const client = new EqueryClient({ fetch: fakeFetch as any });

    client.useFetch("https://api.example.com/injected").onComplete((res) => {
      try {
        expect(called).toBe(true);
        expect(fakeFetch).toHaveBeenCalledWith(
          "https://api.example.com/injected",
          expect.objectContaining({})
        );
        expect(res.data).toEqual({ hello: true });
        done();
      } catch (e) {
        done(e);
      }
    });
  });
});
