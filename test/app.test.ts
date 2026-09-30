import request from "supertest";
import { app } from "../src/app";

describe("GET /", () => {
  it("shows the home page without a login", async () => {
    const res = await request(app).get("/");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Welcome home!");
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
