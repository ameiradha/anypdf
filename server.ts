import express from "express";
import app from "./src/server/app";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 3000;

async function startServer() {
  const isProd = process.env.NODE_ENV === "production" || !!process.env.VERCEL;

  if (!isProd) {
    // Development mode with Vite middleware
    console.log("Starting in DEVELOPMENT mode...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production mode serving static files
    console.log("Starting in PRODUCTION mode...");
    const distPath = path.resolve(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve(distPath, "index.html"), (err) => {
        if (err) {
          res.status(404).send("Application index.html not found. Please ensure the build command was run.");
        }
      });
    });
  }

  // Only listen if not in a serverless function environment that exports the app (like Vercel)
  // Shared AI Studio apps need app.listen()
  if (!process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

startServer().catch(err => {
  console.error("Failed to start server:", err);
});

export default app;
