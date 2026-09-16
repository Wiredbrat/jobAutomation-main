import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { z } from "zod";
import { getStructuredModel } from "../llm.js";
import { connect, getScoredJobsAboveThreshold, markTailored, close } from "../db/database.js";
import { mapWithConcurrency } from "../utils/concurrency.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const resume = JSON.parse(
  readFileSync(join(__dirname, "..", "data", "resume.json"), "utf-8")
);

const SCORE_THRESHOLD = Number(process.env.SCORE_THRESHOLD || 7);
const OUTPUT_ROOT = join(__dirname, "..", "output");

const TailorSchema = z.object({
  resume_markdown: z
    .string()
    .describe(
      "A complete tailored resume in Markdown. Reorder and reword existing " +
        "bullet points to emphasize what matters for this job. Do not invent " +
        "experience, skills, or achievements not present in the source resume."
    ),
  cover_letter_markdown: z
    .string()
    .describe(
      "A concise (3-4 paragraph) cover letter in Markdown, specific to this " +
        "role and company, grounded only in the candidate's real background."
    ),
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

  const education = (r.education || [])
    .map((ed) => `${ed.degree}, ${ed.school} (${ed.end})`)
    .join("\n");

  return `Name: ${r.name}
Title: ${r.title}
Summary: ${r.summary}
Skills: ${r.skills.join(", ")}

Experience:
${experience}

Projects:
${projects}

Education:
${education}`;
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Tailoring prompts are bigger than scoring prompts (full resume + cover
// letter back), so a slightly lower default concurrency than score.js.
const CONCURRENCY = Number(process.env.TAILOR_CONCURRENCY || 2);

async function run() {
  await connect();

  const structuredModel = await getStructuredModel(TailorSchema);
  const jobs = await getScoredJobsAboveThreshold(SCORE_THRESHOLD);

  console.log(
    `Tailoring ${jobs.length} job(s) scoring >= ${SCORE_THRESHOLD} with concurrency ${CONCURRENCY}...\n`
  );

  const resumeText = resumeToText(resume);

  await mapWithConcurrency(jobs, CONCURRENCY, async (job) => {
    const prompt = `Tailor the candidate's resume and write a cover letter for this specific job.

CANDIDATE RESUME:
${resumeText}

JOB TITLE: ${job.title}
COMPANY: ${job.company}
JOB DESCRIPTION:
${(job.description || "").slice(0, 4000)}

Fit notes from earlier screening: ${job.score_reason || "n/a"}`;

    try {
      const result = await structuredModel.invoke(prompt);

      const dirName = `${slugify(job.company)}__${slugify(job.title)}`;
      const outDir = join(OUTPUT_ROOT, dirName);
      mkdirSync(outDir, { recursive: true });

      writeFileSync(join(outDir, "resume.md"), result.resume_markdown, "utf-8");
      writeFileSync(join(outDir, "cover-letter.md"), result.cover_letter_markdown, "utf-8");
      writeFileSync(
        join(outDir, "job-info.md"),
        `# ${job.title} @ ${job.company}\n\nScore: ${job.score}/10\n\n${job.score_reason}\n\nURL: ${job.url}\n`,
        "utf-8"
      );

      await markTailored(job._id, { outputDir: outDir });
      console.log(`✓ ${job.title} @ ${job.company} → ${outDir}`);
    } catch (err) {
      console.error(`Failed to tailor ${job._id}:`, err.message);
    }
  });

  await close();
}

run().catch(async (err) => {
  console.error("Tailoring run failed:", err);
  await close();
  process.exit(1);
});