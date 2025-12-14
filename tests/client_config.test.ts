import { EqueryClient } from "../src/index";

describe("EqueryClient runtime config updates", () => {
  it("should apply updated baseUrl for subsequent requests", (done) => {
    const client = new EqueryClient({ baseUrl: "https://api.example.com" });

    // initial fetch should use original baseUrl
    // @ts-ignore
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    );

    client.useFetch("/path").onComplete(() => {
      try {
        expect(global.fetch).toHaveBeenCalledWith(
          "https://api.example.com/path",
          expect.anything()
        );

        // Update baseUrl
        client.updateConfig({ baseUrl: "https://new.example.com" });

        // call again and verify new baseUrl used
        // @ts-ignore
        global.fetch = jest.fn(() =>
          Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
        );

        client.useFetch("/path").onComplete(() => {
          try {
            expect(global.fetch).toHaveBeenCalledWith(
              "https://new.example.com/path",
              expect.anything()
            );
            done();
          } catch (e) {
            done(e);
          }
        });
      } catch (e) {
        done(e);
      }
    });
  });

  it("should merge updated headers into existing client headers", (done) => {
    const client = new EqueryClient({ headers: { "X-Client": "1" } });

    // initial call
    // @ts-ignore
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    );

    client.useFetch("https://api.example.com/headers").onComplete(() => {
      try {
        expect(global.fetch).toHaveBeenCalledWith(
          "https://api.example.com/headers",
          expect.objectContaining({
            headers: expect.objectContaining({ "X-Client": "1" }),
          })
        );

        // update headers
        client.updateConfig({ headers: { Authorization: "token-abc" } });

        // next call should include both headers
        // @ts-ignore
        global.fetch = jest.fn(() =>
          Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
        );

        client.useFetch("https://api.example.com/headers").onComplete(() => {
          try {
            expect(global.fetch).toHaveBeenCalledWith(
              "https://api.example.com/headers",
              expect.objectContaining({
                headers: expect.objectContaining({
                  "X-Client": "1",
                  Authorization: "token-abc",
                }),
              })
            );
            done();
          } catch (e) {
            done(e);
          }
        });
      } catch (e) {
        done(e);
      }
    });
  });

  it("setConfig should replace the config entirely", (done) => {
    const client = new EqueryClient({
      baseUrl: "https://api.example.com",
      headers: { A: "1" },
    });

    // Replace config
    client.setConfig({
      baseUrl: "https://replaced.example",
      headers: { B: "2" },
    });

    // @ts-ignore
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    );

    client.useFetch("/x").onComplete(() => {
      try {
        expect(global.fetch).toHaveBeenCalledWith(
          "https://replaced.example/x",
          expect.objectContaining({
            headers: expect.objectContaining({ B: "2" }),
          })
        );
        done();
      } catch (e) {
        done(e);
      }
    });
  });
});
