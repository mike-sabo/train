import { createApp } from "./app.js";
import express from "express";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const app = createApp();
if (process.env.NODE_ENV === "production") {
  app.use("/workout-plan", express.static(resolve("dist")));
  app.get("/workout-plan/{*path}", (_req, res) =>
    res.sendFile(resolve("dist/index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
  });
  app.use((req, res, next) => {
    const url = req.url;
    vite.middlewares(req, res, () => {
      req.url = url;
      next();
    });
  });
  app.get("/workout-plan/{*path}", async (req, res, next) => {
    try {
      res
        .type("html")
        .send(
          await vite.transformIndexHtml(
            req.originalUrl,
            await readFile("index.html", "utf8"),
          ),
        );
    } catch (e) {
      next(e);
    }
  });
}
app.get("/", (_req, res) => res.redirect("/workout-plan/"));
const host = process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1";
app.listen(Number(process.env.PORT ?? 5173), host, () =>
  console.log(
    "Train Together: http://localhost:" +
      (process.env.PORT ?? 5173) +
      "/workout-plan/",
  ),
);
