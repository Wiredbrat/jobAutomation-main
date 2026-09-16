import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { notify } from "./notify.js";
import { connect, getTailoredJobs, close } from "../db/database.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function runStep(name, scriptPath) {
  console.log(`\n▶ ${name}`);
  const result = spawnSync("node", [scriptPath], { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${name} exited with code ${result.status}`);
  }
}

async function run() {
  await connect();

  const started = new Date().toISOString();

  runStep("discover", join(__dirname, "discover.js"));
  runStep("scrape", join(__dirname, "scrape.js"));
  runStep("score", join(__dirname, "score.js"));
  runStep("tailor", join(__dirname, "tailor.js"));

  const waiting = await getTailoredJobs();

  if (waiting.length === 0) {
    await notify(`Job pipeline ran at ${started} — nothing new is waiting for review.`);
  } else {
    const lines = waiting
      .slice(0, 15)
      .map((j) => `• *${j.title}* @ ${j.company} — ${j.score}/10\n  ${j.url}`)
      .join("\n\n");

    const more = waiting.length > 15 ? `\n\n...and ${waiting.length - 15} more.` : "";

    await notify(
      `Job pipeline ran at ${started}.\n${waiting.length} job(s) tailored and waiting for your review:\n\n${lines}${more}`
    );
  }

  await close();
}

run().catch(async (err) => {
  console.error("Pipeline failed:", err);
  await notify(`⚠️ Job pipeline failed: ${err.message}`);
  await close();
  process.exit(1);
});