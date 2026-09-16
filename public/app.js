let currentStatus = "all";
let currentJobs = [];

const listEl = document.getElementById("list");
const statsEl = document.getElementById("stats");
const countsEl = document.getElementById("counts");
const tabsEl = document.getElementById("tabs");
const drawerEl = document.getElementById("drawer");
const drawerContentEl = document.getElementById("drawerContent");

tabsEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  currentStatus = btn.dataset.status;
  [...tabsEl.children].forEach((t) => t.classList.toggle("active", t === btn));

  if (currentStatus === "stats") {
    listEl.hidden = true;
    statsEl.hidden = false;
    loadStats();
  } else {
    statsEl.hidden = true;
    listEl.hidden = false;
    load();
  }
});

document.getElementById("drawerClose").addEventListener("click", () => {
  drawerEl.classList.remove("open");
});

function scoreClass(score) {
  if (score == null) return "";
  if (score >= 8) return "good";
  if (score >= 6) return "mid";
  return "low";
}

function renderJobs(jobs) {
  if (jobs.length === 0) {
    listEl.innerHTML = `<div class="empty">Nothing here yet.</div>`;
    return;
  }

  listEl.innerHTML = jobs
    .map(
      (job) => `
    <div class="card" data-id="${job._id}">
      <div class="score ${scoreClass(job.score)}">${job.score ?? "–"}</div>
      <div class="info">
        <div class="title" data-action="open">${escapeHtml(job.title)}</div>
        <div class="company">${escapeHtml(job.company)} · ${job.status}</div>
        ${job.score_reason ? `<div class="reason">${escapeHtml(job.score_reason)}</div>` : ""}
      </div>
      <div class="actions">
        ${
          job.status !== "applied"
            ? `<button class="btn primary" data-action="applied">Applied</button>`
            : ""
        }
        ${
          job.status !== "skipped"
            ? `<button class="btn danger" data-action="skipped">Skip</button>`
            : ""
        }
      </div>
    </div>`
    )
    .join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

listEl.addEventListener("click", async (e) => {
  const card = e.target.closest(".card");
  if (!card) return;
  const id = card.dataset.id;
  const job = currentJobs.find((j) => j._id === id);
  const action = e.target.dataset.action;

  if (action === "open") {
    openDrawer(job);
  } else if (action === "applied" || action === "skipped") {
    await fetch(`/api/jobs/${encodeURIComponent(id)}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: action }),
    });
    load();
  }
});

async function openDrawer(job) {
  drawerContentEl.innerHTML = `
    <h2>${escapeHtml(job.title)}</h2>
    <div class="sub">${escapeHtml(job.company)} · score ${job.score ?? "–"}/10 · ${job.status}</div>
    <p><a href="${job.url}" target="_blank" rel="noopener">Open original posting →</a></p>
    ${job.score_reason ? `<h3>Fit notes</h3><p>${escapeHtml(job.score_reason)}</p>` : ""}
    ${job.output_dir ? `<h3>Tailored resume</h3><pre id="resumePreview">Loading…</pre>
      <h3>Cover letter</h3><pre id="coverPreview">Loading…</pre>` : ""}
  `;
  drawerEl.classList.add("open");

  if (job.output_dir) {
    loadFile(`${job.output_dir}/resume.md`, "resumePreview");
    loadFile(`${job.output_dir}/cover-letter.md`, "coverPreview");
  }
}

async function loadFile(path, elementId) {
  try {
    const res = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
    const text = res.ok ? await res.text() : "(not found)";
    document.getElementById(elementId).textContent = text;
  } catch {
    document.getElementById(elementId).textContent = "(failed to load)";
  }
}

async function load() {
  const res = await fetch(`/api/jobs?status=${currentStatus}`);
  currentJobs = await res.json();
  renderJobs(currentJobs);
  countsEl.textContent = `${currentJobs.length} shown`;
}

const STATUS_ORDER = ["new", "scored", "tailored", "applied", "skipped"];
const STATUS_LABEL = {
  new: "New",
  scored: "Scored",
  tailored: "Tailored",
  applied: "Applied",
  skipped: "Skipped",
};
const SOURCE_LABEL = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  scrape: "Scraped (other ATS)",
};

function pct(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

function barRow(label, count, max, extraClass = "") {
  const width = max ? Math.max(pct(count, max), count > 0 ? 2 : 0) : 0;
  return `
    <div class="bar-row">
      <div class="bar-label">${escapeHtml(label)}</div>
      <div class="bar-track"><div class="bar-fill ${extraClass}" style="width:${width}%"></div></div>
      <div class="bar-count">${count}</div>
    </div>`;
}

function renderStats(stats) {
  const maxStatus = Math.max(1, ...STATUS_ORDER.map((s) => stats.statusCounts[s] || 0));
  const funnelHtml = STATUS_ORDER.map((s) =>
    barRow(STATUS_LABEL[s], stats.statusCounts[s] || 0, maxStatus, `bar-${s}`)
  ).join("");

  const maxSource = Math.max(1, ...Object.values(stats.sourceCounts));
  const sourceHtml = Object.entries(stats.sourceCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => barRow(SOURCE_LABEL[source] || source, count, maxSource))
    .join("");

  const maxCompany = Math.max(1, ...stats.topCompanies.map((c) => c.count));
  const companyHtml = stats.topCompanies.length
    ? stats.topCompanies.map((c) => barRow(c.company, c.count, maxCompany)).join("")
    : `<div class="empty">No jobs yet.</div>`;

  const scoreBuckets = new Map(stats.scoreDistribution.map((s) => [s.score, s.count]));
  const maxScoreCount = Math.max(1, ...stats.scoreDistribution.map((s) => s.count));
  const scoreHistogram = Array.from({ length: 10 }, (_, i) => i + 1)
    .map((score) => {
      const count = scoreBuckets.get(score) || 0;
      const height = Math.max(pct(count, maxScoreCount), count > 0 ? 4 : 0);
      const cls = score >= 8 ? "good" : score >= 6 ? "mid" : "low";
      return `
        <div class="hist-col">
          <div class="hist-bar ${cls}" style="height:${height}%" title="${count} job(s) scored ${score}"></div>
          <div class="hist-label">${score}</div>
        </div>`;
    })
    .join("");

  const maxDaily = Math.max(1, ...stats.dailyDiscovered.map((d) => d.count));
  const dailyHtml = stats.dailyDiscovered.length
    ? `<div class="spark">${stats.dailyDiscovered
        .map((d) => {
          const height = Math.max(pct(d.count, maxDaily), d.count > 0 ? 4 : 0);
          const shortDay = d.day.slice(5); // MM-DD
          return `<div class="spark-col"><div class="spark-bar" style="height:${height}%" title="${d.day}: ${d.count}"></div><div class="spark-label">${shortDay}</div></div>`;
        })
        .join("")}</div>`
    : `<div class="empty">No discovery history yet.</div>`;

  const { avg, min, max, count } = stats.scoreSummary;
  const rateText = (r) => (r == null ? "–" : `${Math.round(r * 100)}%`);

  statsEl.innerHTML = `
    <div class="stat-grid">
      <section class="stat-card">
        <h3>Pipeline funnel</h3>
        ${funnelHtml}
        <div class="stat-footnote">
          Score threshold ≥ ${stats.threshold}: ${rateText(stats.funnel.tailorRate)} of scored jobs get tailored,
          ${rateText(stats.funnel.applyRate)} of tailored jobs get applied to.
        </div>
      </section>

      <section class="stat-card">
        <h3>By source</h3>
        ${sourceHtml}
      </section>

      <section class="stat-card">
        <h3>Score distribution</h3>
        ${
          count
            ? `<div class="hist">${scoreHistogram}</div>
               <div class="stat-footnote">avg ${avg.toFixed(1)} · min ${min} · max ${max} · ${count} scored</div>`
            : `<div class="empty">No scored jobs yet.</div>`
        }
      </section>

      <section class="stat-card">
        <h3>Top companies</h3>
        ${companyHtml}
      </section>

      <section class="stat-card wide">
        <h3>Jobs discovered per day</h3>
        ${dailyHtml}
      </section>
    </div>
  `;
}

async function loadStats() {
  statsEl.innerHTML = `<div class="empty">Loading…</div>`;
  try {
    const res = await fetch(`/api/stats`);
    const stats = await res.json();
    renderStats(stats);
    countsEl.textContent = `${stats.total} total jobs`;
  } catch {
    statsEl.innerHTML = `<div class="empty">Failed to load stats.</div>`;
  }
}

load();