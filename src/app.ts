import express, { NextFunction, Request, Response } from "express";
import { homePage } from "./views.js";

export const app = express();

app.get("/", (_req, res) => {
  res.send(homePage());
});

app.get("/health", (_req, res) => {
  res.send("ok");
});

// The deploy workflow polls this until the merged commit is live. Render sets RENDER_GIT_COMMIT.
app.get("/version", (_req, res) => {
  res.json({ commit: process.env.RENDER_GIT_COMMIT ?? null });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).send("Something went wrong.");
});
