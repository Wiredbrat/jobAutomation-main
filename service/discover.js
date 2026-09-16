import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fetchGreenhouseJobs } from "./greenhouse.js";
import { fetchLeverJobs } from "./lever.js";
import { connect, upsertJob, getNewJobs, countJobs, close } from "../db/database.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const companies = JSON.parse(
  readFileSync(join(__dirname, "..", "data", "companies.json"), "utf-8")
);

// Optional: only keep jobs whose title matches one of these (case-insensitive).
// Leave empty to keep everything.
const TITLE_FILTER = ["engineer", "developer", "frontend", "backend", "full stack", "fullstack"];

function matchesFilter(title) {
  if (TITLE_FILTER.length === 0) return true;
  const lower = title.toLowerCase();
  return TITLE_FILTER.some((kw) => lower.includes(kw));
}

async function run() {
  await connect();

  const before = await countJobs();

  for (const boardToken of companies.greenhouse || []) {
    const jobs = await fetchGreenhouseJobs(boardToken);
    const kept = jobs.filter((j) => matchesFilter(j.title));
    for (const job of kept) await upsertJob(job);
    console.log(`[greenhouse] ${boardToken}: ${jobs.length} fetched, ${kept.length} kept`);
  }

  for (const site of companies.lever || []) {
    const jobs = await fetchLeverJobs(site);
    const kept = jobs.filter((j) => matchesFilter(j.title));
    for (const job of kept) await upsertJob(job);
    console.log(`[lever] ${site}: ${jobs.length} fetched, ${kept.length} kept`);
  }

  const after = await countJobs();
  console.log(`\nDone. ${after} total jobs in db (${after - before} net new).`);

  const pending = await getNewJobs();
  console.log(`${pending.length} jobs awaiting scoring.`);

  await close();
}

run().catch(async (err) => {
  console.error("Discovery run failed:", err);
  await close();
  process.exit(1);
});
