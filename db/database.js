import "dotenv/config";
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DB || "job_search_bot";

let client = null;
let jobsCollection = null;

/**
 * Opens the MongoDB connection. Must be called once, explicitly, before any
 * of the query functions below are used (e.g. at server startup, or at the
 * top of a standalone script's run()). Safe to call more than once — it's a
 * no-op if already connected.
 */
export async function connect() {
  if (jobsCollection) return jobsCollection;

  client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  jobsCollection = db.collection("jobs");

  // _id is the natural unique key here (e.g. "greenhouse:stripe:12345"),
  // so no extra index needed for uniqueness. This index speeds up the
  // "give me unscored jobs" query used by the next pipeline step.
  await jobsCollection.createIndex({ status: 1 });

  console.log(`[db] connected to ${dbName}`);
  return jobsCollection;
}

export async function close() {
  if (client) {
    await client.close();
    client = null;
    jobsCollection = null;
  }
}

/**
 * Every query function below goes through this instead of calling connect()
 * itself, so a missing connect() call fails fast and loudly instead of
 * silently opening a new connection on whichever call happens to run first.
 */
function getCollection() {
  if (!jobsCollection) {
    throw new Error(
      "Database not connected. Call connect() once at startup before using the database."
    );
  }
  return jobsCollection;
}

/**
 * Insert a new job or update the mutable fields (title/location/description)
 * on an existing one, without touching status/score if already set.
 */
export async function upsertJob(job) {
  const jobs = getCollection();
  const { id, ...fields } = job;

  await jobs.updateOne(
    { _id: id },
    {
      $set: {
        source: fields.source,
        company: fields.company,
        title: fields.title,
        location: fields.location,
        url: fields.url,
        description: fields.description,
        posted_at: fields.posted_at,
      },
      $setOnInsert: {
        first_seen_at: new Date().toISOString(),
        status: "new",
      },
    },
    { upsert: true }
  );
}

export async function getNewJobs() {
  const jobs = getCollection();
  return jobs.find({ status: "new" }).sort({ first_seen_at: -1 }).toArray();
}

export async function updateJobScore(id, { score, score_reason }) {
  const jobs = getCollection();
  await jobs.updateOne(
    { _id: id },
    { $set: { score, score_reason, status: "scored", scored_at: new Date().toISOString() } }
  );
}

export async function getScoredJobsAboveThreshold(threshold) {
  const jobs = getCollection();
  return jobs
    .find({ status: "scored", score: { $gte: threshold } })
    .sort({ score: -1 })
    .toArray();
}

export async function markTailored(id, { outputDir }) {
  const jobs = getCollection();
  await jobs.updateOne(
    { _id: id },
    { $set: { status: "tailored", tailored_at: new Date().toISOString(), output_dir: outputDir } }
  );
}

export async function getTailoredJobs() {
  const jobs = getCollection();
  return jobs.find({ status: "tailored" }).sort({ score: -1 }).toArray();
}

export async function markApplied(id) {
  const jobs = getCollection();
  await jobs.updateOne(
    { _id: id },
    { $set: { status: "applied", applied_at: new Date().toISOString() } }
  );
}

export async function markSkipped(id) {
  const jobs = getCollection();
  await jobs.updateOne({ _id: id }, { $set: { status: "skipped" } });
}

export async function listJobs({ status } = {}) {
  const jobs = getCollection();
  const filter = status && status !== "all" ? { status } : {};
  return jobs.find(filter).sort({ score: -1, first_seen_at: -1 }).toArray();
}

export async function setStatus(id, status) {
  const jobs = getCollection();
  const extra = status === "applied" ? { applied_at: new Date().toISOString() } : {};
  await jobs.updateOne({ _id: id }, { $set: { status, ...extra } });
}

export async function countJobs() {
  const jobs = getCollection();
  return jobs.countDocuments();
}

/**
 * One-shot aggregate for the dashboard's Stats tab. Runs a handful of small
 * aggregations in parallel rather than pulling every job document back and
 * crunching numbers in JS — this stays cheap even once the collection has
 * thousands of jobs in it.
 */
export async function getStats() {
  const jobs = getCollection();

  const [
    total,
    statusRows,
    sourceRows,
    companyRows,
    scoreDistRows,
    scoreSummaryRows,
    dailyRows,
  ] = await Promise.all([
    jobs.countDocuments(),
    jobs.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]).toArray(),
    jobs.aggregate([{ $group: { _id: "$source", count: { $sum: 1 } } }]).toArray(),
    jobs
      .aggregate([
        { $group: { _id: "$company", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ])
      .toArray(),
    jobs
      .aggregate([
        { $match: { score: { $ne: null } } },
        { $group: { _id: "$score", count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ])
      .toArray(),
    jobs
      .aggregate([
        { $match: { score: { $ne: null } } },
        {
          $group: {
            _id: null,
            avg: { $avg: "$score" },
            min: { $min: "$score" },
            max: { $max: "$score" },
            count: { $sum: 1 },
          },
        },
      ])
      .toArray(),
    // first_seen_at is stored as an ISO string (see upsertJob), so a plain
    // substring gives us the YYYY-MM-DD bucket without a date-parsing stage.
    jobs
      .aggregate([
        { $match: { first_seen_at: { $ne: null } } },
        { $project: { day: { $substrCP: ["$first_seen_at", 0, 10] } } },
        { $group: { _id: "$day", count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
        { $limit: 30 },
      ])
      .toArray(),
  ]);

  const statusCounts = Object.fromEntries(statusRows.map((r) => [r._id, r.count]));
  const sourceCounts = Object.fromEntries(sourceRows.map((r) => [r._id, r.count]));
  const scoreSummary = scoreSummaryRows[0] || { avg: null, min: null, max: null, count: 0 };

  const threshold = Number(process.env.SCORE_THRESHOLD || 7);
  const scoredOrLater =
    (statusCounts.scored || 0) +
    (statusCounts.tailored || 0) +
    (statusCounts.applied || 0) +
    (statusCounts.skipped || 0);
  const tailoredOrLater = (statusCounts.tailored || 0) + (statusCounts.applied || 0);
  const applied = statusCounts.applied || 0;

  return {
    total,
    statusCounts,
    sourceCounts,
    topCompanies: companyRows.map((r) => ({ company: r._id || "(unknown)", count: r.count })),
    scoreDistribution: scoreDistRows.map((r) => ({ score: r._id, count: r.count })),
    scoreSummary,
    dailyDiscovered: dailyRows.map((r) => ({ day: r._id, count: r.count })),
    threshold,
    funnel: {
      scoredOrLater,
      tailoredOrLater,
      applied,
      tailorRate: scoredOrLater ? tailoredOrLater / scoredOrLater : null,
      applyRate: tailoredOrLater ? applied / tailoredOrLater : null,
    },
  };
}
