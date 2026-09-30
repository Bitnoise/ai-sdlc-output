import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { app } from "../src/app";

describe("GET /", () => {
  it("serves the single-page app without a login", async () => {
    const res = await request(app).get("/");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("<title>Which Vans Go Electric?</title>");
    expect(res.text).toContain("<h1>Which Vans Go Electric?</h1>");
    expect(res.text).toContain('<div id="app">');
  });

  it("states that every van is checked against every EV model", async () => {
    const res = await request(app).get("/");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Every van is checked against every EV model for range, payload and 5-year saving.");
  });

  it("states what the results page includes", async () => {
    const res = await request(app).get("/");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Results include a data quality report, check figures, the shortlist, assumptions and CSV downloads.");
  });

  it("states that vendor exports are accepted and trip files are combined", async () => {
    const res = await request(app).get("/");

    expect(res.status).toBe(200);
    expect(res.text).toContain("several trip files are combined");
  });

  it("states the Ops worst-day range rule", async () => {
    const res = await request(app).get("/");

    expect(res.status).toBe(200);
    expect(res.text).toContain("worst day fits within 60% of the EV WLTP range");
  });

  describe("with a built client", () => {
    let dir: string;

    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "client-"));
      fs.mkdirSync(path.join(dir, "assets"));
      fs.writeFileSync(path.join(dir, "index.html"), "<title>Which Vans Go Electric?</title>built");
      fs.writeFileSync(path.join(dir, "assets", "x.js"), "console.log(1);");
      process.env.CLIENT_DIR = dir;
    });

    afterAll(() => {
      delete process.env.CLIENT_DIR;
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("serves the built index.html", async () => {
      const res = await request(app).get("/");

      expect(res.status).toBe(200);
      expect(res.text).toContain("built");
    });

    it("serves static assets", async () => {
      const res = await request(app).get("/assets/x.js");

      expect(res.status).toBe(200);
      expect(res.text).toBe("console.log(1);");
    });
  });
});

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.text).toBe("ok");
  });
});

describe("GET /version", () => {
  it("returns the deployed commit", async () => {
    process.env.RENDER_GIT_COMMIT = "abc123";

    const res = await request(app).get("/version");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ commit: "abc123" });
    delete process.env.RENDER_GIT_COMMIT;
  });

  it("returns null outside Render", async () => {
    const res = await request(app).get("/version");

    expect(res.body).toEqual({ commit: null });
  });
});

describe("Server actions", () => {
  it("invokes server endpoints to trigger actions", async () => {
    const healthRes = await request(app).get("/health");
    expect(healthRes.status).toBe(200);
    expect(healthRes.text).toBe("ok");

    const versionRes = await request(app).get("/version");
    expect(versionRes.status).toBe(200);
    expect(versionRes.body).toEqual({ commit: null });
  });
});
