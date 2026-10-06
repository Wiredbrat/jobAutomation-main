import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fetchGreenhouseJobs } from "./greenhouse.js";
import { fetchLeverJobs } from "./lever.js";
import { fetchAshbyJobs } from "./ashby.js";
import { fetchSmartRecruitersJobs } from "./smartrecruiters.js";
import { fetchRecruiteeJobs } from "./recruitee.js";
import { fetchWorkableJobs } from "./workable.js";
import { isLocationEligible } from "../utils/match.js";
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

// Each entry is one ATS with a public, unauthenticated JSON API. Adding a
// new platform later is just one more entry here — companies.json gets a
// matching array key (populated via `npm run resolve-boards`), and the rest
// of the pipeline (score/tailor/apply) needs no changes since every fetcher
// already returns the same job shape.
const SOURCES = [
  { key: "greenhouse", label: "greenhouse", fetch: fetchGreenhouseJobs },
  { key: "lever", label: "lever", fetch: fetchLeverJobs },
  { key: "ashby", label: "ashby", fetch: fetchAshbyJobs },
  { key: "smartrecruiters", label: "smartrecruiters", fetch: fetchSmartRecruitersJobs },
  { key: "recruitee", label: "recruitee", fetch: fetchRecruiteeJobs },
  { key: "workable", label: "workable", fetch: fetchWorkableJobs },
];

async function run() {
  await connect();

  const before = await countJobs();

  for (const { key, label, fetch } of SOURCES) {
    for (const slug of companies[key] || []) {
      const jobs = await fetch(slug);
      const kept = jobs.filter((j) => matchesFilter(j.title) && isLocationEligible(j));
      for (const job of kept) await upsertJob(job);
      console.log(`[${label}] ${slug}: ${jobs.length} fetched, ${kept.length} kept`);
    }
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
