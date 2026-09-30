import express, { NextFunction, Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";

export const app = express();

// The browser app is built by Vite into dist/client. Resolved per request so CLIENT_DIR can be set in tests.
function clientDir(): string {
  return process.env.CLIENT_DIR ?? path.resolve(process.cwd(), "dist/client");
}

app.get("/health", (_req, res) => {
  res.send("ok");
});

// The deploy workflow polls this until the merged commit is live. Render sets RENDER_GIT_COMMIT.
app.get("/version", (_req, res) => {
  res.json({ commit: process.env.RENDER_GIT_COMMIT ?? null });
});

app.get("/", (_req, res) => {
  const built = path.join(clientDir(), "index.html");
  // Without a build (tests, CI) fall back to the source index.html, which has the same static heading.
  const source = path.resolve(process.cwd(), "index.html");
  const file = fs.existsSync(built) ? built : fs.existsSync(source) ? source : null;
  if (!file) {
    res.status(503).send("The app is not built.");
    return;
  }
  res.sendFile(file);
});

app.use((req, res, next) => {
  express.static(clientDir(), { index: false })(req, res, next);
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).send("Something went wrong.");
});
