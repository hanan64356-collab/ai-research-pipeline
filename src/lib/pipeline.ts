export type PipelineForm = {
  topic: string;
  subtopics: string;
  description: string;
  reviewerEmail: string;
};

export type TavilyResult = {
  title: string;
  url: string;
  snippet: string;
  score: number;
};

export type SheetRow = {
  timestamp: string;
  topic: string;
  subtopics: string;
  reviewerEmail: string;
  driveLink: string;
  revisions: number;
  status: "Completed";
};

export const DEMO_FORM: PipelineForm = {
  topic: "Solar Mini-Grids for Rural Health Clinics in Ethiopia",
  subtopics: "cold-chain vaccine storage, tariff models, maintenance training",
  description: "Briefing for a regional health bureau, decision-maker level, 2026 data.",
  reviewerEmail: "hanan.reviewer@invisionafrica.org",
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);

export function tavilyResults(form: PipelineForm): TavilyResult[] {
  const subs = splitSubtopics(form.subtopics);
  const base: TavilyResult[] = [
    {
      title: "Mini-grid deployment and clinic electrification: field evidence",
      url: "https://www.irena.org/publications/mini-grid-electrification",
      snippet:
        "Hybrid solar-battery mini-grids raised clinic uptime from 41% to 94% across 128 surveyed facilities, with the largest gains in night-time obstetric care.",
      score: 0.94,
    },
    {
      title: "Cost benchmarks: PV + storage for institutional loads",
      url: "https://www.seforall.org/data-and-evidence/mini-grid-cost-benchmarks",
      snippet:
        "Installed cost of 1.1–1.8 USD/Wp for 15–60 kWp clinic systems; battery replacement at year 8 dominates lifecycle cost.",
      score: 0.9,
    },
    {
      title: "Reliability requirements for medical cold chain",
      url: "https://www.who.int/teams/immunization/supply-chain-energy",
      snippet:
        "WHO PQS guidance requires 2–8 °C continuity with 72h autonomy; solar direct-drive refrigerators avoid battery dependency for vaccine storage.",
      score: 0.88,
    },
  ];
  const extra = subs.slice(0, 3).map((s, i) => ({
    title: `${s.replace(/^\w/, (c) => c.toUpperCase())} — comparative review`,
    url: `https://scholar.example.org/${slug(s)}-review`,
    snippet: `Synthesis of 12 studies covering ${s} in low-resource settings, including failure modes, staffing needs and measured outcomes.`,
    score: 0.86 - i * 0.04,
  }));
  return [...base, ...extra];
}

export function splitSubtopics(subtopics: string): string[] {
  return subtopics
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function buildReportHtml(
  form: PipelineForm,
  results: TavilyResult[],
  revision = 0,
  feedback: string[] = [],
): string {
  const subs = splitSubtopics(form.subtopics);
  const sections = subs.length ? subs : ["Current landscape", "Risks", "Recommendations"];

  const revisionNote =
    revision > 0
      ? `<div class="rev"><strong>Revision ${revision}</strong> — updated after reviewer feedback:
        <ul>${feedback.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul></div>`
      : "";

  const body = sections
    .map(
      (s, i) => `
      <h2>${i + 1}. ${escapeHtml(capitalize(s))}</h2>
      <p>${escapeHtml(
        `Evidence on ${s} converges on three practical points for ${form.description || "the target audience"}.`,
      )}</p>
      <ul>
        <li>Baseline: measured performance data from comparable deployments, not vendor claims.</li>
        <li>Cost driver: ${
          i % 2 === 0
            ? "capital expenditure per installed watt-peak"
            : "operations, spare parts and local technician availability"
        }.</li>
        <li>Decision input: ${
          revision > 0
            ? "quantified figures and a 5-year cost table, as requested by the reviewer."
            : "qualitative comparison across the shortlisted options."
        }</li>
      </ul>`,
    )
    .join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(form.topic)}</title></head>
<body>
  <h1>${escapeHtml(form.topic)}</h1>
  <p class="meta">Prepared for ${escapeHtml(form.reviewerEmail)} · ${
    revision > 0 ? `Revision ${revision}` : "Draft 1"
  } · Sources: ${results.length}</p>
  ${revisionNote}
  <h2>Executive summary</h2>
  <p>${escapeHtml(
    form.description ||
      "Structured research synthesis produced from live web research and reviewed by a human before publication.",
  )}</p>
  ${body}
  <h2>References</h2>
  <ol>
    ${results.map((r) => `<li><a href="${r.url}">${escapeHtml(r.title)}</a></li>`).join("")}
  </ol>
</body></html>`;
}

export function driveLinkFor(topic: string): string {
  return `https://drive.google.com/file/d/1${hash(topic)}_report/view`;
}

export function pdfNameFor(topic: string): string {
  return `${topic} - Research Report.pdf`;
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1e9;
  return h.toString(36).toUpperCase().padStart(6, "X");
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
