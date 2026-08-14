import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  HardDrive,
  Mail,
  RefreshCcw,
  Table2,
  Workflow,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { WorkflowCanvas, type StageId } from "@/components/WorkflowCanvas";
import {
  DEMO_FORM,
  buildReportHtml,
  driveLinkFor,
  pdfNameFor,
  tavilyResults,
  type PipelineForm,
  type SheetRow,
  type TavilyResult,
} from "@/lib/pipeline";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AI Research Pipeline — Tavily + Human Email Approval" },
      {
        name: "description",
        content:
          "Submit a research topic, get an AI-drafted HTML report by email, reply with feedback or approval, and have the final PDF archived to Drive and logged in Sheets.",
      },
      { property: "og:title", content: "AI Research Pipeline — Tavily + Human Email Approval" },
      {
        property: "og:description",
        content:
          "Form to research to email review loop to PDF in Drive and a logged row in Sheets, in one automated run.",
      },
    ],
  }),
  component: Index,
});

type LogLine = { at: string; node: string; text: string };

function now() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Index() {
  const [form, setForm] = useState<PipelineForm>(DEMO_FORM);
  const [active, setActive] = useState<StageId | null>(null);
  const [completed, setCompleted] = useState<StageId[]>([]);
  const [log, setLog] = useState<LogLine[]>([]);
  const [results, setResults] = useState<TavilyResult[]>([]);
  const [reportHtml, setReportHtml] = useState("");
  const [revision, setRevision] = useState(0);
  const [feedback, setFeedback] = useState("Add a 5-year cost table and cite 2026 figures.");
  const [feedbackHistory, setFeedbackHistory] = useState<string[]>([]);
  const [awaitingReply, setAwaitingReply] = useState(false);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState<{ drive: string; pdf: string } | null>(null);
  const [rows, setRows] = useState<SheetRow[]>([]);
  const emailRef = useRef<HTMLDivElement>(null);

  const push = useCallback((node: string, text: string) => {
    setLog((l) => [...l, { at: now(), node, text }]);
  }, []);

  const run = useCallback(
    async (stage: StageId, node: string, text: string, ms = 750) => {
      setActive(stage);
      push(node, text);
      await wait(ms);
      setCompleted((c) => (c.includes(stage) ? c : [...c, stage]));
    },
    [push],
  );

  async function startRun() {
    setRunning(true);
    setFinished(null);
    setCompleted([]);
    setLog([]);
    setRevision(0);
    setFeedbackHistory([]);
    await run("form", "Form Trigger", `Submission received for "${form.topic}"`, 600);
    await run("tavily", "Tavily Search", "Querying Tavily with topic + subtopics + context", 1100);
    const res = tavilyResults(form);
    setResults(res);
    push("Tavily Search", `${res.length} sources returned`);
    await run("llm", "AI Agent", "Composing HTML research report from sources", 1200);
    setReportHtml(buildReportHtml(form, res, 0));
    await run("mail", "Gmail", `Draft emailed to ${form.reviewerEmail}`, 800);
    setActive("switch");
    setAwaitingReply(true);
    push("Wait for reply", "Waiting for the reviewer to answer APPROVED or FEEDBACK::");
    setRunning(false);
    emailRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function replyFeedback() {
    if (!feedback.trim()) return;
    setAwaitingReply(false);
    setRunning(true);
    const nextRev = revision + 1;
    const history = [...feedbackHistory, feedback.trim()];
    await run("switch", "Switch", "Reply matched FEEDBACK:: branch", 600);
    await run("revise", "AI Agent", `Revising report — cycle ${nextRev}`, 1200);
    setFeedbackHistory(history);
    setRevision(nextRev);
    setReportHtml(buildReportHtml(form, results, nextRev, history));
    await run("mail", "Gmail", `Revision ${nextRev} emailed back to reviewer`, 800);
    setCompleted((c) => c.filter((s) => s !== "revise" || true));
    setActive("switch");
    setAwaitingReply(true);
    push("Wait for reply", "Loop continues until the reviewer approves");
    setRunning(false);
  }

  async function replyApproved() {
    setAwaitingReply(false);
    setRunning(true);
    await run("switch", "Switch", "Reply matched APPROVED branch", 600);
    await run("pdf", "HTML → PDF", `Rendering ${pdfNameFor(form.topic)}`, 1100);
    const drive = driveLinkFor(form.topic);
    await run("drive", "Google Drive", "PDF uploaded to /Research Reports", 900);
    await run("sheet", "Google Sheets", "Appending row to Research Log", 800);
    setRows((r) => [
      {
        timestamp: new Date().toISOString().slice(0, 16).replace("T", " "),
        topic: form.topic,
        subtopics: form.subtopics,
        reviewerEmail: form.reviewerEmail,
        driveLink: drive,
        revisions: revision,
        status: "Completed",
      },
      ...r,
    ]);
    await run("done", "Gmail", "Final \u201cIt\u2019s done\u201d email sent", 800);
    setActive(null);
    setFinished({ drive, pdf: pdfNameFor(form.topic) });
    setRunning(false);
  }

  const field = (k: keyof PipelineForm) => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value })),
  });

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6">
      <header className="pt-14 pb-10">
        <Badge variant="outline" className="gap-2 border-primary/40 text-primary">
          <Workflow className="size-3.5" /> n8n · Tavily · Gmail · Drive · Sheets
        </Badge>
        <h1 className="mt-5 text-4xl leading-[1.05] font-bold sm:text-5xl">
          AI Research Pipeline with
          <span className="text-primary"> human approval</span>
        </h1>
        <p className="mt-4 max-w-2xl text-base text-muted-foreground">
          One submission triggers live web research, an AI-written HTML report and an email review
          loop. Nothing gets archived until a human replies <span className="text-accent">APPROVED</span>.
        </p>
        <div className="mt-6 h-px w-40 rule-gradient" />
      </header>

      <WorkflowCanvas active={active} completed={completed} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <section className="panel p-6">
          <h2 className="text-lg font-semibold">1 · Research request form</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            These four fields are the webhook payload the workflow starts from.
          </p>
          <div className="mt-5 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="topic">Main topic *</Label>
              <Input id="topic" {...field("topic")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subtopics">Subtopics</Label>
              <Input id="subtopics" placeholder="comma separated" {...field("subtopics")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description / context</Label>
              <Textarea id="description" rows={3} {...field("description")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reviewer">Reviewer email *</Label>
              <Input id="reviewer" type="email" {...field("reviewerEmail")} />
            </div>
            <Button
              className="w-full"
              size="lg"
              disabled={running || !form.topic || !form.reviewerEmail}
              onClick={startRun}
            >
              {running ? "Running workflow…" : "Submit research request"}
              <ArrowRight className="size-4" />
            </Button>
          </div>

          <div className="mt-6 rounded-lg border border-border bg-node p-4">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Execution log
            </p>
            <div className="mt-3 max-h-48 space-y-1.5 overflow-y-auto font-mono text-[11px]">
              {log.length === 0 && <p className="text-muted-foreground">No executions yet.</p>}
              {log.map((l, i) => (
                <p key={i} className="text-muted-foreground">
                  <span className="text-primary">{l.at}</span> [{l.node}] {l.text}
                </p>
              ))}
            </div>
          </div>
        </section>

        <div className="space-y-6">
          <section className="panel p-6" ref={emailRef}>
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold">2 · Reviewer inbox</h2>
              {revision > 0 && <Badge variant="secondary">Revision {revision}</Badge>}
            </div>
            {!reportHtml ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Submit the form to receive the draft report by email.
              </p>
            ) : (
              <>
                <div className="mt-4 rounded-lg border border-border bg-node">
                  <div className="border-b border-border p-4">
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      <Mail className="size-4 text-primary" />
                      {revision > 0 ? `Revised Research Draft` : "Research Draft"}: {form.topic}
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                      to {form.reviewerEmail} · reply with APPROVED or FEEDBACK:: your notes
                    </p>
                  </div>
                  <div
                    className="max-h-72 overflow-y-auto p-4 text-sm leading-relaxed [&_a]:text-primary [&_h1]:mb-2 [&_h1]:font-display [&_h1]:text-xl [&_h1]:font-bold [&_h2]:mt-4 [&_h2]:mb-1 [&_h2]:font-display [&_h2]:text-sm [&_h2]:font-semibold [&_li]:mb-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:text-muted-foreground [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:text-muted-foreground [&_.meta]:font-mono [&_.meta]:text-[11px] [&_.rev]:mt-3 [&_.rev]:rounded-md [&_.rev]:border [&_.rev]:border-accent/40 [&_.rev]:p-3 [&_.rev]:text-xs"
                    dangerouslySetInnerHTML={{ __html: reportHtml }}
                  />
                </div>

                {awaitingReply && (
                  <div className="mt-4 space-y-3">
                    <Label htmlFor="fb">Your reply</Label>
                    <Textarea
                      id="fb"
                      rows={2}
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" disabled={running} onClick={replyFeedback}>
                        <RefreshCcw className="size-4" /> Send FEEDBACK
                      </Button>
                      <Button disabled={running} onClick={replyApproved}>
                        <CheckCircle2 className="size-4" /> Reply APPROVED
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>

          <section className="panel p-6">
            <h2 className="text-lg font-semibold">3 · Archive</h2>
            {!finished ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Drive upload and the Sheets row are written only after approval.
              </p>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="flex items-start gap-3 rounded-lg border border-primary/40 bg-node p-4">
                  <HardDrive className="mt-0.5 size-4 text-primary" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{finished.pdf}</p>
                    <p className="truncate font-mono text-[11px] text-primary">{finished.drive}</p>
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-node p-4">
                  <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    <Table2 className="size-3.5" /> Research Log (Google Sheets)
                  </p>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full table-fixed text-left font-mono text-[11px]">
                      <thead className="text-muted-foreground">
                        <tr>
                          <th className="w-[6.5rem] py-1 pr-3">Date</th>
                          <th className="py-1 pr-3">Topic</th>
                          <th className="w-[3rem] py-1 pr-3">Rev</th>
                          <th className="w-[5rem] py-1">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={i} className="border-t border-border">
                            <td className="py-1.5 pr-3">{r.timestamp.slice(0, 10)}</td>
                            <td className="truncate py-1.5 pr-3">{r.topic}</td>
                            <td className="py-1.5 pr-3">{r.revisions}</td>
                            <td className="py-1.5 text-primary">{r.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="size-4 text-primary" /> “It’s done” email sent to{" "}
                  {form.reviewerEmail}
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
