import { useFetch } from "../src/index";

describe("Headers safety", () => {
  it("should handle undefined headers without throwing and pass an object to fetch", (done) => {
    const url = "https://api.example.com/headers-test";

    // Mock fetch to return a successful empty JSON
    // @ts-ignore
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    );

    useFetch(url, { headers: undefined }).onComplete((result) => {
      try {
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(global.fetch).toHaveBeenCalledWith(
          url,
          expect.objectContaining({
            headers: expect.any(Object),
          })
        );
        expect(result.isSuccess).toBe(true);
        done();
      } catch (e) {
        done(e);
      }
    });
  });
});
