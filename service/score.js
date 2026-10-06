import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { scoreJob, isLocationEligible } from "../utils/match.js";
import { connect, getNewJobs, updateJobScore, setStatus, close } from "../db/database.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const resume = JSON.parse(
  readFileSync(join(__dirname, "..", "data", "resume.json"), "utf-8")
);

async function run() {
  await connect();
  const jobs = await getNewJobs();
  console.log(`Scoring ${jobs.length} job(s) with strict keyword matching (no AI calls, no rate limits)...\n`);

  let excluded = 0;
  for (const job of jobs) {
    if (!isLocationEligible(job)) {
      await setStatus(job._id, "excluded_location");
      excluded++;
      continue;
    }
    const { score, reason } = scoreJob(job, resume);
    await updateJobScore(job._id, { score, score_reason: reason });
    console.log(`[${score}/10] ${job.title} @ ${job.company} — ${reason}`);
  }

  console.log(`\nDone. ${excluded} job(s) excluded for location mismatch.`);
  await close();
}

run().catch(async (err) => {
  console.error("Scoring run failed:", err);
  await close();
  process.exit(1);
});
