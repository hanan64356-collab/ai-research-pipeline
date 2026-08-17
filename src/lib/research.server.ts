/**
 * Server-only implementation of the research pipeline:
 * Tavily web search -> AI report -> Gmail -> PDF -> Google Drive -> Google Sheets.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type Source = { title: string; url: string; snippet: string; score: number };

const GATEWAY = "https://connector-gateway.lovable.dev";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim().replace(/^["']|["']$/g, "");
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}


async function gateway(
  connector: "google_mail" | "google_drive" | "google_sheets",
  path: string,
  init: RequestInit & { rawBody?: BodyInit } = {},
): Promise<Response> {
  const keyName =
    connector === "google_mail"
      ? "GOOGLE_MAIL_API_KEY"
      : connector === "google_drive"
        ? "GOOGLE_DRIVE_API_KEY"
        : "GOOGLE_SHEETS_API_KEY";
  const res = await fetch(`${GATEWAY}/${connector}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requireEnv("LOVABLE_API_KEY")}`,
      "X-Connection-Api-Key": requireEnv(keyName),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Gateway ${connector} ${path} failed [${res.status}]: ${body}`);
    throw new Error(`${connector} request failed [${res.status}]: ${body}`);
  }
  return res;
}

/* ------------------------------ Tavily search ----------------------------- */

export async function tavilySearch(
  topic: string,
  subtopics: string,
  description: string,
): Promise<Source[]> {
  const query = [topic, subtopics, description].filter(Boolean).join(" — ").slice(0, 380);
  const key = requireEnv("TAVILY_API_KEY");
  const payload = {
    query,
    search_depth: "advanced",
    max_results: 8,
    include_answer: false,
  };

  const call = (mode: "bearer" | "body") =>
    fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(mode === "bearer" ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify(mode === "bearer" ? payload : { ...payload, api_key: key }),
    });

  let res = await call("bearer");
  if (res.status === 401) res = await call("body");
  if (!res.ok) {
    const body = await res.text();
    console.error(`Tavily search failed [${res.status}]: ${body}`);
    throw new Error(`Tavily search failed [${res.status}]: ${body}`);
  }

  const json = (await res.json()) as {
    results?: { title?: string; url?: string; content?: string; score?: number }[];
  };
  return (json.results ?? []).map((r) => ({
    title: r.title ?? "Untitled source",
    url: r.url ?? "",
    snippet: (r.content ?? "").slice(0, 600),
    score: typeof r.score === "number" ? r.score : 0,
  }));
}

/* --------------------------------- AI report ------------------------------- */

async function callAi(system: string, user: string): Promise<string> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${requireEnv("LOVABLE_API_KEY")}`,
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`AI gateway failed [${res.status}]: ${body}`);
    throw new Error(`AI request failed [${res.status}]: ${body}`);
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("The AI returned an empty report.");
  return text;
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

/* ---------------------------------- Gmail --------------------------------- */

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const message = [
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(html, "utf8").toString("base64"),
  ].join("\r\n");
  const raw = Buffer.from(message, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  await gateway("google_mail", "/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
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

/* ------------------------------- Google Drive ----------------------------- */

export async function uploadPdfToDrive(
  name: string,
  bytes: Uint8Array,
): Promise<{ id: string; link: string }> {
  const boundary = `lovable${crypto.randomUUID().replace(/-/g, "")}`;
  const metadata = JSON.stringify({ name, mimeType: "application/pdf" });
  const head =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const body = new Blob([head, bytes as BlobPart, tail]);

  const res = await gateway(
    "google_drive",
    "/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    },
  );
  const json = (await res.json()) as { id: string; webViewLink?: string };
  return {
    id: json.id,
    link: json.webViewLink ?? `https://drive.google.com/file/d/${json.id}/view`,
  };
}

/* ------------------------------ Google Sheets ----------------------------- */

const SHEET_TAB = "Research Log";
const HEADERS = [
  "Timestamp",
  "Topic",
  "Subtopics",
  "Reviewer email",
  "Revisions",
  "Drive link",
  "Status",
];

async function createLogSpreadsheet(): Promise<string> {
  const res = await gateway("google_sheets", "/v4/spreadsheets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      properties: { title: "AI Research Pipeline — Research Log" },
      sheets: [{ properties: { title: SHEET_TAB } }],
    }),
  });
  const json = (await res.json()) as { spreadsheetId: string };
  await gateway(
    "google_sheets",
    `/v4/spreadsheets/${json.spreadsheetId}/values/${SHEET_TAB}!A1:G1?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: [HEADERS] }),
    },
  );
  return json.spreadsheetId;
}

export async function appendLogRow(row: (string | number)[]): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "research_log_spreadsheet_id")
    .maybeSingle();

  let spreadsheetId = data?.value;
  if (!spreadsheetId) {
    spreadsheetId = await createLogSpreadsheet();
    await supabaseAdmin
      .from("app_settings")
      .upsert({ key: "research_log_spreadsheet_id", value: spreadsheetId }, { onConflict: "key" });
  }

  await gateway(
    "google_sheets",
    `/v4/spreadsheets/${spreadsheetId}/values/${SHEET_TAB}!A:G:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: [row] }),
    },
  );
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}
