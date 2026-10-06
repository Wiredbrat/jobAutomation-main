import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rules = JSON.parse(
  readFileSync(join(__dirname, "..", "data", "matchRules.json"), "utf-8")
);

function normalize(str) {
  return (str || "").toLowerCase();
}

/**
 * Hard pass/fail gate, run BEFORE scoring. A job with no India/remote signal
 * doesn't get a lower score — it's excluded from the pipeline entirely, so
 * you never waste a "tailor" or "apply" step on a non-India role.
 */
export function isLocationEligible(job) {
  const haystack = normalize(
    [job.location, job.title, (job.description || "").slice(0, 500)].join(" ")
  );
  if (rules.location.block.some((kw) => haystack.includes(kw))) return false;
  if (!job.location) return true; // unknown location — don't reject blind
  return rules.location.allow.some((kw) => haystack.includes(kw));
}

function extractSkillMatches(text, skills) {
  const haystack = normalize(text);
  return skills.filter((skill) => haystack.includes(normalize(skill)));
}

/**
 * Deterministic 1-10 fit score — pure string matching against resume.json's
 * own skills/title. No network call, no tokens, no rate limit. Replaces the
 * old LLM call in score.js.
 */
export function scoreJob(job, resume) {
  const text = `${job.title} ${job.description || ""}`;
  const matchedSkills = extractSkillMatches(text, resume.skills);
  const titleHit = rules.titleKeywords.some((kw) => normalize(job.title).includes(kw));

  const raw = matchedSkills.length * rules.skillWeight + (titleHit ? rules.titleWeight : 0);
  const ceiling = 8 * rules.skillWeight + rules.titleWeight; // realistic ceiling, not theoretical max
  const score = Math.max(1, Math.min(10, Math.round((raw / ceiling) * 10)));

  const reason = [
    matchedSkills.length
      ? `Matches ${matchedSkills.length} skill(s): ${matchedSkills.slice(0, 6).join(", ")}`
      : "No direct skill keyword matches found",
    titleHit ? "title matches target roles" : "title doesn't match target roles",
  ].join("; ");

  return { score, reason, matchedSkills, eligible: matchedSkills.length >= rules.minSkillMatches };
}
