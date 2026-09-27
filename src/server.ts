import express, { NextFunction, Request, Response } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import bcrypt from "bcryptjs";
import { createUser, findUserByEmail, findUserById, migrate, pool } from "./db";
import { homePage, loginPage, registerPage } from "./views";

declare module "express-session" {
  interface SessionData {
    userId: number;
  }
}

const PORT = Number(process.env.PORT ?? 3000);
const SESSION_SECRET = process.env.SESSION_SECRET;
const isProduction = process.env.NODE_ENV === "production";

if (!SESSION_SECRET) {
  throw new Error("SESSION_SECRET is not set");
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

const app = express();
const PgStore = connectPgSimple(session);

// Needed behind a hosting proxy (Render, Railway, Fly) so secure cookies work.
app.set("trust proxy", 1);
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    store: new PgStore({ pool, tableName: "session" }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
);

function readCredentials(req: Request): { email: string; password: string } {
  const email = String(req.body.email ?? "").trim().toLowerCase();
  const password = String(req.body.password ?? "");
  return { email, password };
}

function requireGuest(req: Request, res: Response, next: NextFunction) {
  if (req.session.userId) return res.redirect("/");
  next();
}

// Regenerate the session id on login to prevent session fixation.
function logIn(req: Request, userId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
    });
  });
}

app.get("/", async (req, res) => {
  const user = req.session.userId ? await findUserById(req.session.userId) : undefined;
  if (!user) return res.redirect("/login");
  res.send(homePage(user.email));
});

app.get("/login", requireGuest, (_req, res) => {
  res.send(loginPage());
});

app.post("/login", requireGuest, async (req, res) => {
  const { email, password } = readCredentials(req);
  const user = await findUserByEmail(email);
  const valid = user ? await bcrypt.compare(password, user.password_hash) : false;

  if (!user || !valid) {
    return res.status(401).send(loginPage({ email, error: "Wrong email or password." }));
  }

  await logIn(req, user.id);
  res.redirect("/");
});

app.get("/register", requireGuest, (_req, res) => {
  res.send(registerPage());
});

app.post("/register", requireGuest, async (req, res) => {
  const { email, password } = readCredentials(req);

  if (!EMAIL_RE.test(email)) {
    return res.status(400).send(registerPage({ email, error: "Enter a valid email address." }));
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).send(
      registerPage({ email, error: `Password must have at least ${MIN_PASSWORD_LENGTH} characters.` }),
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await createUser(email, passwordHash);
  if (!user) {
    return res.status(409).send(registerPage({ email, error: "An account with this email already exists." }));
  }

  await logIn(req, user.id);
  res.redirect("/");
});

app.post("/logout", (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("connect.sid");
    res.redirect("/login");
  });
});

app.get("/health", (_req, res) => {
  res.send("ok");
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).send("Something went wrong.");
});

migrate()
  .then(() => {
    app.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("Failed to start:", err);
    process.exit(1);
  });
