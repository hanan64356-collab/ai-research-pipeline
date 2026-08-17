/** Orchestration for the research pipeline. Server-only. */
import {
  appendLogRow,
  generateReport,
  renderPdf,
  reviseReport,
  sendEmail,
  tavilySearch,
  uploadPdfToDrive,
  type Source,
} from "./research.server";
import { completedEmail, reviewEmail } from "./emails.server";

type Row = {
  id: string;
  topic: string;
  subtopics: string;
  description: string;
  reviewer_email: string;
  status: string;
  report_html: string | null;
  sources: Source[];
  feedback: string[];
  revisions: number;
  review_token: string;
  pdf_name: string | null;
  drive_link: string | null;
  error_message: string | null;
  created_at: string;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function safeOrigin(origin: string): string {
  return new URL(origin).origin;
}

function reviewLinks(origin: string, token: string) {
  const base = `${safeOrigin(origin)}/review/${token}`;
  return { reviewUrl: base, approveUrl: `${base}?approve=1` };
}

function slug(topic: string): string {
  return (
    topic
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "research-report"
  );
}

async function fail(id: string, message: string) {
  const db = await admin();
  await db.from("research_requests").update({ status: "failed", error_message: message }).eq("id", id);
}

export async function runInitialResearch(input: {
  topic: string;
  subtopics: string;
  description: string;
  reviewerEmail: string;
  origin: string;
}) {
  const db = await admin();
  const { data, error } = await db
    .from("research_requests")
    .insert({
      topic: input.topic,
      subtopics: input.subtopics,
      description: input.description,
      reviewer_email: input.reviewerEmail,
      status: "researching",
    })
    .select("id, review_token")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not save the request.");

  const id = data.id as string;
  const token = data.review_token as string;

  try {
    const sources = await tavilySearch(input.topic, input.subtopics, input.description);
    if (sources.length === 0) throw new Error("No web sources were found for this topic.");
    await db.from("research_requests").update({ sources, status: "drafting" }).eq("id", id);

    const reportHtml = await generateReport({ ...input, sources });
    const links = reviewLinks(input.origin, token);
    await sendEmail(
      input.reviewerEmail,
      `Review needed: ${input.topic}`,
      reviewEmail({ topic: input.topic, reportHtml, revision: 0, sources, ...links }),
    );
    await db
      .from("research_requests")
      .update({ report_html: reportHtml, status: "awaiting_review" })
      .eq("id", id);
    return { id, status: "awaiting_review" as const };
  } catch (e) {
    const message = e instanceof Error ? e.message : "The pipeline failed.";
    await fail(id, message);
    throw new Error(message);
  }
}

export async function listRequests() {
  const db = await admin();
  const { data, error } = await db
    .from("research_requests")
    .select("id, topic, status, revisions, sources, drive_link, pdf_name, error_message, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    topic: r.topic as string,
    status: r.status as string,
    revisions: r.revisions as number,
    sourceCount: ((r.sources ?? []) as Source[]).length,
    driveLink: r.drive_link as string | null,
    pdfName: r.pdf_name as string | null,
    error: r.error_message as string | null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }));
}

export async function readStatus(id: string) {
  const db = await admin();
  const { data } = await db
    .from("research_requests")
    .select("id, topic, status, revisions, sources, drive_link, pdf_name, error_message, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    topic: data.topic as string,
    status: data.status as string,
    revisions: data.revisions as number,
    sourceCount: ((data.sources ?? []) as Source[]).length,
    driveLink: data.drive_link as string | null,
    pdfName: data.pdf_name as string | null,
    error: data.error_message as string | null,
    createdAt: data.created_at as string,
  };
}

async function byToken(token: string): Promise<Row> {
  const db = await admin();
  const { data } = await db.from("research_requests").select("*").eq("review_token", token).maybeSingle();
  if (!data) throw new Error("This review link is not valid.");
  return data as unknown as Row;
}

export async function readReview(token: string) {
  const row = await byToken(token);
  return {
    topic: row.topic,
    subtopics: row.subtopics,
    description: row.description,
    status: row.status,
    revisions: row.revisions,
    reportHtml: row.report_html,
    sources: row.sources ?? [],
    feedback: row.feedback ?? [],
    driveLink: row.drive_link,
    pdfName: row.pdf_name,
  };
}

export async function runRevision(input: { token: string; feedback: string; origin: string }) {
  const row = await byToken(input.token);
  if (row.status !== "awaiting_review") throw new Error("This report is not awaiting review.");
  const db = await admin();
  const history = [...(row.feedback ?? []), input.feedback];
  await db.from("research_requests").update({ status: "revising", feedback: history }).eq("id", row.id);

  try {
    const reportHtml = await reviseReport({
      topic: row.topic,
      currentHtml: row.report_html ?? "",
      feedback: history,
      sources: row.sources ?? [],
    });
    const revision = row.revisions + 1;
    const links = reviewLinks(input.origin, row.review_token);
    await sendEmail(
      row.reviewer_email,
      `Revision ${revision}: ${row.topic}`,
      reviewEmail({
        topic: row.topic,
        reportHtml,
        revision,
        sources: row.sources ?? [],
        ...links,
      }),
    );
    await db
      .from("research_requests")
      .update({ report_html: reportHtml, revisions: revision, status: "awaiting_review" })
      .eq("id", row.id);
    return { status: "awaiting_review" as const, revisions: revision };
  } catch (e) {
    const message = e instanceof Error ? e.message : "The revision failed.";
    await fail(row.id, message);
    throw new Error(message);
  }
}

export async function runFinalization(token: string) {
  const row = await byToken(token);
  if (row.status === "completed") {
    return { status: "completed" as const, driveLink: row.drive_link, pdfName: row.pdf_name };
  }
  if (row.status !== "awaiting_review") throw new Error("This report is not awaiting review.");
  if (!row.report_html) throw new Error("There is no report to finalise.");

  const db = await admin();
  await db.from("research_requests").update({ status: "finalizing" }).eq("id", row.id);

  try {
    const pdfName = `${slug(row.topic)}-${new Date().toISOString().slice(0, 10)}.pdf`;
    const bytes = await renderPdf(
      row.report_html,
      `${row.topic} — approved ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
    );
    const drive = await uploadPdfToDrive(pdfName, bytes);
    const sheetLink = await appendLogRow([
      new Date().toISOString().slice(0, 16).replace("T", " "),
      row.topic,
      row.subtopics,
      row.reviewer_email,
      row.revisions,
      drive.link,
      "Approved",
    ]);
    await sendEmail(
      row.reviewer_email,
      `It's done: ${row.topic}`,
      completedEmail({
        topic: row.topic,
        driveLink: drive.link,
        sheetLink,
        revisions: row.revisions,
        pdfName,
      }),
    );
    await db
      .from("research_requests")
      .update({
        status: "completed",
        pdf_name: pdfName,
        drive_link: drive.link,
        drive_file_id: drive.id,
      })
      .eq("id", row.id);
    return { status: "completed" as const, driveLink: drive.link, pdfName, sheetLink };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Finalisation failed.";
    await fail(row.id, message);
    throw new Error(message);
  }
}
