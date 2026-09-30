import express, { NextFunction, Request, Response } from "express";
import { homePage } from "./views";

export const app = express();

app.use(express.urlencoded({ extended: false }));

app.get("/", (_req, res) => {
  res.send(homePage());
});

app.get("/health", (_req, res) => {
  res.send("ok");
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).send("Something went wrong.");
});
