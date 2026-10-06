import express from "express";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { connect, listJobs, setStatus, getStats, close } from "./db/database.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.DASHBOARD_PORT || 3000;

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, "public")));

// Serve tailored resume/cover-letter files so the dashboard can link to them
app.use("/output", express.static(join(__dirname, "output")));

app.get("/api/jobs", async (req, res) => {
  try {
    const jobs = await listJobs({ status: req.query.status });
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/stats", async (req, res) => {
  try {
    const stats = await getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/jobs/:id/status", async (req, res) => {
  const { status } = req.body;
  const allowed = ["new", "scored", "tailored", "applied", "skipped"];
  // "new" is also the requeue target for jobs the strict location filter
  // excluded — the dashboard's "Requeue" button on those cards uses this.
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowed.join(", ")}` });
  }
  try {
    await setStatus(req.params.id, status);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serves a tailored resume/cover-letter's raw markdown as plain text,
// so the dashboard can show it inline without a markdown renderer dependency.
app.get("/api/file", (req, res) => {
  const path = req.query.path;
  if (!path || !path.startsWith(join(__dirname, "output"))) {
    return res.status(400).send("Invalid path");
  }
  if (!existsSync(path)) return res.status(404).send("Not found");
  res.type("text/plain").send(readFileSync(path, "utf-8"));
});

/**
 * Open the DB connection once, up front, before the server starts accepting
 * requests — rather than letting it connect lazily on whichever request
 * happens to hit the database first.
 */
async function start() {
  try {
    await connect();
  } catch (err) {
    console.error("Failed to connect to the database, exiting:", err.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Dashboard running at http://localhost:${PORT}`);
  });
}

start();

process.on("SIGINT", async () => {
  await close();
  process.exit(0);
});
