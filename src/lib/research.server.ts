/**
 * Server-only research pipeline (no Lovable/Tavily dependencies):
 * Gemini web search -> AI report -> SMTP email -> PDF -> Supabase Storage + log.
 */
import nodemailer from "nodemailer";

export type Source = { title: string; url: string; snippet: string; score: number };

const GEMINI_MODEL = "gemini-3.6-flash";
const STORAGE_BUCKET = "research-reports";

function env(name: string): string {
  return process.env[name]?.trim().replace(/^["']|["']$/g, "") ?? "";
}

function requireEnv(name: string): string {
  const value = env(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function geminiKey(): string {
  return requireEnv("GEMINI_API_KEY");
}

export function appOrigin(): string {
  const configured = env("APP_URL");
  if (configured) return configured.replace(/\/$/, "");
  const vercel = env("VERCEL_URL");
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "")}`;
  return "http://localhost:8080";
}

async function geminiGenerate(body: Record<string, unknown>): Promise<Response> {
  const key = geminiKey();
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify(body),
    },
  );
}

/* ------------------------------ Web search -------------------------------- */

function sourcesFromGrounding(json: {
  candidates?: {
    groundingMetadata?: {
      groundingChunks?: { web?: { uri?: string; title?: string } }[];
    };
    content?: { parts?: { text?: string }[] };
  }[];
}): Source[] {
  const chunks = json.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const fromWeb = chunks
    .map((c, i) => ({
      title: c.web?.title ?? `Source ${i + 1}`,
      url: c.web?.uri ?? "",
      snippet: "",
      score: 1 - i * 0.05,
    }))
    .filter((s) => s.url);
  if (fromWeb.length > 0) return fromWeb.slice(0, 8);

  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  try {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]) as { title?: string; url?: string; snippet?: string }[];
      return parsed
        .filter((s) => s.url)
        .map((s, i) => ({
          title: s.title ?? `Source ${i + 1}`,
          url: s.url ?? "",
          snippet: (s.snippet ?? "").slice(0, 600),
          score: 1 - i * 0.05,
        }))
        .slice(0, 8);
    }
  } catch {
    /* fall through */
  }
  return [];
}

export async function webSearch(
  topic: string,
  subtopics: string,
  description: string,
): Promise<Source[]> {
  const query = [topic, subtopics, description].filter(Boolean).join(" — ").slice(0, 380);

  let res = await geminiGenerate({
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              `Find current, authoritative web sources for this research brief:\n${query}\n\n` +
              "Prefer recent reports, official sites, and reputable news.",
          },
        ],
      },
    ],
    tools: [{ google_search: {} }],
  });

  if (!res.ok) {
    res = await geminiGenerate({
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                `List 6–8 authoritative web sources for:\n${query}\n\n` +
                'Return ONLY a JSON array: [{"title":"...","url":"https://...","snippet":"..."}]',
            },
          ],
        },
      ],
    });
  }

  if (!res.ok) {
    const body = await res.text();
    console.error(`Gemini search failed [${res.status}]: ${body}`);
    throw new Error(`Web search failed [${res.status}]: ${body}`);
  }

  const json = (await res.json()) as Parameters<typeof sourcesFromGrounding>[0];
  const sources = sourcesFromGrounding(json);
  if (sources.length === 0) {
    throw new Error("No web sources were found for this topic.");
  }
  return sources;
}

/** @deprecated Use webSearch — kept for pipeline import compatibility */
export const tavilySearch = webSearch;

/* --------------------------------- AI report ------------------------------- */

async function callGemini(system: string, user: string): Promise<string> {
  const res = await geminiGenerate({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Gemini API failed [${res.status}]: ${body}`);
    throw new Error(`AI request failed [${res.status}]: ${body}`);
  }
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
  if (!text) throw new Error("The AI returned an empty report.");
  return text;
}

async function callAi(system: string, user: string): Promise<string> {
  return callGemini(system, user);
}

const REPORT_SYSTEM =
  "You are a senior research analyst. You write concise, decision-ready research reports as a " +
  "single HTML fragment. Use only these tags: h1, h2, h3, p, ul, ol, li, strong, em, a, table, " +
  "thead, tbody, tr, th, td. Never output <html>, <head>, <body>, <script>, <style>, markdown " +
  "fences or inline styles. Ground every claim in the supplied sources and cite them inline as " +
  "[n] matching their numbering. Finish with an <h2>References</h2> section listing each source " +
  "as a numbered link.";

function sourceBlock(sources: Source[]): string {
  return sources
    .map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\nExcerpt: ${s.snippet}`)
    .join("\n\n");
}

export async function generateReport(input: {
  topic: string;
  subtopics: string;
  description: string;
  sources: Source[];
}): Promise<string> {
  const html = await callAi(
    REPORT_SYSTEM,
    `Main topic: ${input.topic}
Subtopics to cover as sections: ${input.subtopics || "choose the most decision-relevant sections"}
Context and audience: ${input.description || "an informed general audience"}

Write the report with an <h1> title, an "Executive summary" section, one section per subtopic,
a "Risks and open questions" section, a "Recommendations" section, and the references.

Sources:
${sourceBlock(input.sources)}`,
  );
  return stripHtmlWrapper(html);
}

export async function reviseReport(input: {
  topic: string;
  currentHtml: string;
  feedback: string[];
  sources: Source[];
}): Promise<string> {
  const html = await callAi(
    REPORT_SYSTEM,
    `Revise the research report below on "${input.topic}" so it fully addresses the reviewer's
feedback. Keep everything that was already correct, keep the same overall structure, and keep the
references accurate. Return the complete revised report, not a diff.

Reviewer feedback, oldest first:
${input.feedback.map((f, i) => `${i + 1}. ${f}`).join("\n")}

Available sources:
${sourceBlock(input.sources)}

Current report:
${input.currentHtml}`,
  );
  return stripHtmlWrapper(html);
}

function stripHtmlWrapper(html: string): string {
  return html
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/<\/?(?:html|head|body|!doctype)[^>]*>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .trim();
}

/* ------------------------------ SMTP email -------------------------------- */

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const user = env("SMTP_USER");
  const pass = env("SMTP_PASS");
  if (!user || !pass) {
    console.warn(`[email skipped — SMTP not configured] To: ${to}, Subject: ${subject}`);
    return;
  }

  const transport = nodemailer.createTransport({
    host: env("SMTP_HOST") || "smtp.gmail.com",
    port: Number(env("SMTP_PORT") || 587),
    secure: false,
    auth: { user, pass },
  });

  await transport.sendMail({
    from: env("SMTP_FROM") || user,
    to,
    subject,
    html,
  });
}

/* ----------------------------- HTML -> PDF -------------------------------- */

type Block = { text: string; size: number; bold: boolean; bullet: boolean; gap: number };

function htmlToBlocks(html: string): Block[] {
  const blocks: Block[] = [];
  const tagRe = /<(h1|h2|h3|p|li)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html)) !== null) {
    const tag = (match[1] ?? "p").toLowerCase();
    const text = decodeEntities((match[2] ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (tag === "h1") blocks.push({ text, size: 20, bold: true, bullet: false, gap: 16 });
    else if (tag === "h2") blocks.push({ text, size: 14, bold: true, bullet: false, gap: 12 });
    else if (tag === "h3") blocks.push({ text, size: 12, bold: true, bullet: false, gap: 10 });
    else if (tag === "li") blocks.push({ text, size: 10.5, bold: false, bullet: true, gap: 5 });
    else blocks.push({ text, size: 10.5, bold: false, bullet: false, gap: 8 });
  }
  return blocks;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&[a-z]+;/gi, " ");
}

function sanitizeForPdf(s: string): string {
  return s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2022/g, "-")
    .replace(/[^\x20-\x7e]/g, "");
}

export async function renderPdf(reportHtml: string, footer: string): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const width = 595.28;
  const height = 841.89;
  const margin = 56;
  const maxWidth = width - margin * 2;

  let page = doc.addPage([width, height]);
  let y = height - margin;

  const newPage = () => {
    page = doc.addPage([width, height]);
    y = height - margin;
  };

  for (const block of htmlToBlocks(reportHtml)) {
    const font = block.bold ? bold : regular;
    const indent = block.bullet ? 14 : 0;
    const words = sanitizeForPdf(block.text).split(" ").filter(Boolean);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, block.size) > maxWidth - indent) {
        if (line) lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);

    y -= block.gap;
    for (let i = 0; i < lines.length; i++) {
      if (y < margin + 40) newPage();
      const prefix = block.bullet && i === 0 ? "- " : "";
      page.drawText(`${prefix}${lines[i]}`, {
        x: margin + (block.bullet && i > 0 ? indent : 0),
        y,
        size: block.size,
        font,
        color: rgb(0.1, 0.1, 0.12),
      });
      y -= block.size * 1.45;
    }
  }

  const stamp = sanitizeForPdf(footer);
  for (const p of doc.getPages()) {
    p.drawText(stamp, {
      x: margin,
      y: 28,
      size: 8,
      font: regular,
      color: rgb(0.45, 0.45, 0.5),
    });
  }
  return doc.save();
}

/* --------------------------- Supabase Storage ----------------------------- */

async function ensureStorageBucket() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: buckets } = await supabaseAdmin.storage.listBuckets();
  if (!buckets?.some((b) => b.name === STORAGE_BUCKET)) {
    const { error } = await supabaseAdmin.storage.createBucket(STORAGE_BUCKET, { public: true });
    if (error && !error.message.includes("already exists")) {
      throw new Error(`Could not create storage bucket: ${error.message}`);
    }
  }
}

export async function uploadPdfToDrive(
  name: string,
  bytes: Uint8Array,
): Promise<{ id: string; link: string }> {
  await ensureStorageBucket();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const path = `${Date.now()}-${name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;

  const { error } = await supabaseAdmin.storage.from(STORAGE_BUCKET).upload(path, bytes, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (error) throw new Error(`PDF upload failed: ${error.message}`);

  const { data } = supabaseAdmin.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return { id: path, link: data.publicUrl };
}

/* ----------------------------- Research log ------------------------------- */

export async function appendLogRow(
  row: (string | number)[],
  appUrl = "/",
): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [loggedAt, topic, subtopics, reviewerEmail, revisions, archiveLink, status] = row;
  const entry = {
    logged_at: String(loggedAt),
    topic: String(topic),
    subtopics: String(subtopics),
    reviewer_email: String(reviewerEmail),
    revisions: Number(revisions),
    archive_link: String(archiveLink),
    status: String(status),
  };

  const { error } = await supabaseAdmin.from("research_log").insert(entry);
  if (error) {
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "research_log_entries")
      .maybeSingle();
    const entries = data?.value ? (JSON.parse(data.value) as typeof entry[]) : [];
    entries.unshift(entry);
    await supabaseAdmin.from("app_settings").upsert(
      { key: "research_log_entries", value: JSON.stringify(entries.slice(0, 100)) },
      { onConflict: "key" },
    );
  }

  return appUrl.endsWith("/") ? `${appUrl}#submission-status` : `${appUrl}/#submission-status`;
}
