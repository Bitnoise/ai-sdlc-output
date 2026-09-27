import request from "supertest";
import { app } from "../src/app";
import { migrate, pool } from "../src/db";

const EMAIL = "user@example.com";
const PASSWORD = "secret123";

async function register(agent: ReturnType<typeof request.agent>, email = EMAIL, password = PASSWORD) {
  return agent.post("/register").type("form").send({ email, password });
}

beforeAll(async () => {
  await migrate();
});

beforeEach(async () => {
  await pool.query("TRUNCATE users, session RESTART IDENTITY");
});

afterAll(async () => {
  await pool.end();
});

describe("GET /", () => {
  it("redirects to /login when not logged in", async () => {
    const res = await request(app).get("/");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login");
  });
});

describe("POST /register", () => {
  it("creates the user, logs them in and shows the home page", async () => {
    const agent = request.agent(app);

    const res = await register(agent);
    const home = await agent.get("/");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/");
    expect(home.status).toBe(200);
    expect(home.text).toContain(EMAIL);
  });

  it("stores a bcrypt hash, not the plain password", async () => {
    await register(request.agent(app));

    const { rows } = await pool.query("SELECT password_hash FROM users WHERE email = $1", [EMAIL]);

    expect(rows[0].password_hash).not.toBe(PASSWORD);
    expect(rows[0].password_hash).toMatch(/^\$2[aby]\$/);
  });

  it("saves the email in lower case", async () => {
    await register(request.agent(app), "  User@Example.COM ");

    const { rows } = await pool.query("SELECT email FROM users");

    expect(rows).toEqual([{ email: EMAIL }]);
  });

  it("rejects an email that is already registered", async () => {
    await register(request.agent(app));

    const res = await register(request.agent(app));

    expect(res.status).toBe(409);
    expect(res.text).toContain("already exists");
  });

  it("rejects an invalid email", async () => {
    const res = await register(request.agent(app), "not-an-email");

    expect(res.status).toBe(400);
  });

  it("rejects a password that is too short", async () => {
    const res = await register(request.agent(app), EMAIL, "short");

    expect(res.status).toBe(400);
    const { rowCount } = await pool.query("SELECT 1 FROM users");
    expect(rowCount).toBe(0);
  });
});

describe("POST /login", () => {
  beforeEach(async () => {
    await register(request.agent(app));
  });

  it("logs in with the correct password", async () => {
    const agent = request.agent(app);

    const res = await agent.post("/login").type("form").send({ email: EMAIL, password: PASSWORD });
    const home = await agent.get("/");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/");
    expect(home.text).toContain(EMAIL);
  });

  it("rejects a wrong password", async () => {
    const res = await request(app).post("/login").type("form").send({ email: EMAIL, password: "wrong-password" });

    expect(res.status).toBe(401);
    expect(res.text).toContain("Wrong email or password.");
  });

  it("rejects an unknown email with the same message", async () => {
    const res = await request(app)
      .post("/login")
      .type("form")
      .send({ email: "nobody@example.com", password: PASSWORD });

    expect(res.status).toBe(401);
    expect(res.text).toContain("Wrong email or password.");
  });
});

describe("POST /logout", () => {
  it("ends the session", async () => {
    const agent = request.agent(app);
    await register(agent);

    const res = await agent.post("/logout");
    const home = await agent.get("/");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login");
    expect(home.status).toBe(302);
    expect(home.headers.location).toBe("/login");
  });
});
