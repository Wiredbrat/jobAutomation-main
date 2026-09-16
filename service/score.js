import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { z } from "zod";
import { getStructuredModel } from "../llm.js";
import { connect, getNewJobs, updateJobScore, close } from "../db/database.js";
import { mapWithConcurrency } from "../utils/concurrency.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const resume = JSON.parse(
  readFileSync(join(__dirname, "..", "data", "resume.json"), "utf-8")
);

const ScoreSchema = z.object({
  score: z.number().min(1).max(10).describe("Fit score from 1 (poor fit) to 10 (excellent fit)"),
  reason: z.string().describe("2-3 sentence explanation of the score"),
});

function resumeToText(r) {
  const experience = r.experience
    .map(
      (e) =>
        `${e.role} at ${e.company} (${e.start} - ${e.end}):\n` +
        e.highlights.map((h) => `- ${h}`).join("\n")
    )
    .join("\n\n");

  const projects = (r.projects || [])
    .map((p) => `${p.name}: ${p.description}\n` + p.highlights.map((h) => `- ${h}`).join("\n"))
    .join("\n\n");

  return `Name: ${r.name}
Title: ${r.title}
Summary: ${r.summary}
Skills: ${r.skills.join(", ")}

Experience:
${experience}

Projects:
${projects}`;
}

// How many jobs to score at once. Higher = faster overall, but hits your
// LLM provider's free-tier rate limit sooner — 3 is a safe starting point,
// raise it if your provider tolerates more.
const CONCURRENCY = Number(process.env.SCORE_CONCURRENCY || 3);

async function run() {
  await connect();

  const structuredModel = await getStructuredModel(ScoreSchema);

  const jobs = await getNewJobs();
  console.log(`Scoring ${jobs.length} job(s) with concurrency ${CONCURRENCY}...\n`);

  const resumeText = resumeToText(resume);

  await mapWithConcurrency(jobs, CONCURRENCY, async (job) => {
    const prompt = `You are helping a candidate evaluate job fit. Compare the candidate's resume against the job description below and rate how good a fit this role is.

CANDIDATE RESUME:
${resumeText}

JOB TITLE: ${job.title}
COMPANY: ${job.company}
JOB DESCRIPTION:
${(job.description || "").slice(0, 4000)}

Rate the fit from 1-10 and explain briefly why.`;

    try {
      const result = await structuredModel.invoke(prompt);
      await updateJobScore(job._id, { score: result.score, score_reason: result.reason });
      console.log(`[${result.score}/10] ${job.title} @ ${job.company} — ${result.reason}`);
    } catch (err) {
      console.error(`Failed to score ${job._id}:`, err.message);
    }
  });

  await close();
}

run().catch(async (err) => {
  console.error("Scoring run failed:", err);
  await close();
  process.exit(1);
});