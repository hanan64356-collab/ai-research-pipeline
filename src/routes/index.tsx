import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  Clock,
  HardDrive,
  Loader2,
  Mail,
  RefreshCw,
  Table2,
  Workflow,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { WorkflowCanvas, type StageId } from "@/components/WorkflowCanvas";
import { DEMO_FORM, type PipelineForm } from "@/lib/pipeline";
import {
  getRequestStatus,
  listRequests,
  runResearchPipeline,
  submitResearch,
} from "@/lib/research.functions";

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
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type LogLine = { at: string; node: string; text: string };

type Submission = Awaited<ReturnType<typeof listRequests>>[number];

function now() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

const STAGE_ORDER: StageId[] = [
  "form",
  "tavily",
  "llm",
  "mail",
  "switch",
  "revise",
  "pdf",
  "drive",
  "sheet",
  "done",
];

function stagesFor(status: string): { active: StageId | null; completed: StageId[] } {
  const upTo = (id: StageId, active: StageId | null) => ({
    active,
    completed: STAGE_ORDER.slice(0, STAGE_ORDER.indexOf(id) + 1),
  });
  switch (status) {
    case "researching":
      return upTo("form", "tavily");
    case "drafting":
      return upTo("tavily", "llm");
    case "awaiting_review":
      return upTo("mail", "switch");
    case "revising":
      return upTo("switch", "revise");
    case "finalizing":
      return upTo("revise", "pdf");
    case "completed":
      return { active: null, completed: STAGE_ORDER };
    default:
      return { active: null, completed: [] };
  }
}

type SubmissionStep = "research" | "drafting" | "approval";

const completedStatuses: Record<SubmissionStep, Set<string>> = {
  research: new Set(["drafting", "awaiting_review", "revising", "finalizing", "completed"]),
  drafting: new Set(["awaiting_review", "revising", "finalizing", "completed"]),
  approval: new Set(["completed"]),
};

function StepStatus({ step, status }: { step: SubmissionStep; status: string }) {
  const done = completedStatuses[step].has(status);
  const active =
    (step === "research" && status === "researching") ||
    (step === "drafting" && ["drafting", "revising"].includes(status)) ||
    (step === "approval" && ["awaiting_review", "finalizing"].includes(status));
  const failed = status === "failed";
  const label = done ? "Done" : active ? "In progress" : failed ? "Blocked" : "Waiting";
  const Icon = done ? CheckCircle2 : active ? Clock : failed ? XCircle : Circle;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex size-7 items-center justify-center rounded-md border ${
            done
              ? "border-success/35 bg-success/10 text-success"
              : active
                ? "border-warning/35 bg-warning/10 text-warning"
                : failed
                  ? "border-destructive/35 bg-destructive/10 text-destructive"
                  : "border-border bg-node text-muted-foreground"
          }`}
          aria-label={`${step}: ${label}`}
        >
          <Icon className={`size-4 ${active ? "animate-pulse" : ""}`} />
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function Index() {
  const [form, setForm] = useState<PipelineForm>(DEMO_FORM);
  const [log, setLog] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof getRequestStatus>>>(null);
  const [error, setError] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);

  const submit = useServerFn(submitResearch);
  const readStatus = useServerFn(getRequestStatus);
  const fetchAll = useServerFn(listRequests);

  const refreshSubmissions = useCallback(async () => {
    setLoadingSubmissions(true);
    try {
      const rows = await fetchAll();
      setSubmissions(rows);
    } catch {
      /* ignore list errors */
    } finally {
      setLoadingSubmissions(false);
    }
  }, [fetchAll]);

  useEffect(() => {
    void refreshSubmissions();
  }, [refreshSubmissions]);

  const push = useCallback((node: string, text: string) => {
    setLog((l) => [...l, { at: now(), node, text }]);
  }, []);

  useEffect(() => {
    if (!requestId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await readStatus({ data: { id: requestId } });
        if (cancelled || !next) return;
        setStatus((prev) => {
          if (prev?.status !== next.status) {
            push("Workflow", `Status → ${next.status.replace(/_/g, " ")}`);
          }
          return next;
        });
        if (next.status !== prevRef.current) {
          prevRef.current = next.status;
          void refreshSubmissions();
        }
      } catch {
        /* transient polling failure */
      }
    };
    const prevRef = { current: "" };
    void tick();
    const id = window.setInterval(tick, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [requestId, readStatus, push, refreshSubmissions]);

  async function startRun() {
    setRunning(true);
    setError(null);
    setLog([]);
    setStatus(null);
    setRequestId(null);
    push("Form Trigger", `Submission received for "${form.topic}"`);
    push("Tavily Search", "Searching the live web and drafting the report…");
    statusRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    try {
      const res = await submit({
        data: {
          topic: form.topic,
          subtopics: form.subtopics,
          description: form.description,
          reviewerEmail: form.reviewerEmail,
          origin: window.location.origin,
        },
      });
      setRequestId(res.id);
      push("Gmail", `Draft emailed to ${form.reviewerEmail} — check the inbox to review`);
      void refreshSubmissions();
    } catch (e) {
      const message = e instanceof Error ? e.message : "The workflow failed.";
      setError(message);
      push("Error", message);
    } finally {
      setRunning(false);
    }
  }

  const stages = stagesFor(status?.status ?? (running ? "researching" : ""));

  const field = (k: keyof PipelineForm) => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value })),
  });

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6">
      <header className="pt-14 pb-10">
        <Badge variant="outline" className="gap-2 border-primary/40 text-primary">
          <Workflow className="size-3.5" /> Tavily · AI · Gmail · Drive · Sheets
        </Badge>
        <h1 className="mt-5 text-4xl leading-[1.05] font-bold sm:text-5xl">
          AI Research Pipeline with
          <span className="text-primary"> human approval</span>
        </h1>
        <p className="mt-4 max-w-2xl text-base text-muted-foreground">
          One submission triggers live web research, an AI-written HTML report and a real email
          review loop. Nothing is archived until the reviewer approves from their inbox.
        </p>
        <div className="mt-6 h-px w-40 rule-gradient" />
      </header>

      <WorkflowCanvas active={stages.active} completed={stages.completed} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <section className="panel p-6">
          <h2 className="text-lg font-semibold">1 · Research request form</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            These four fields are the payload the workflow starts from.
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
              {running ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Researching & drafting…
                </>
              ) : (
                <>
                  Submit research request <ArrowRight className="size-4" />
                </>
              )}
            </Button>
            {error && <p className="text-sm text-destructive">{error}</p>}
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
          <section className="panel p-6" ref={statusRef}>
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold">2 · Reviewer inbox</h2>
              {status && status.revisions > 0 && (
                <Badge variant="secondary">Revision {status.revisions}</Badge>
              )}
            </div>
            {!requestId && !running ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Submit the form and the reviewer receives the draft by email, with Approve and Send
                feedback buttons that open a secure review page.
              </p>
            ) : running && !requestId ? (
              <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Searching the web, writing the report and
                sending the email. This takes up to a minute.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <Mail className="size-4 text-primary" /> Draft emailed to {form.reviewerEmail}
                </p>
                <p className="text-sm text-muted-foreground">
                  Status:{" "}
                  <span className="font-mono text-primary">
                    {(status?.status ?? "awaiting_review").replace(/_/g, " ")}
                  </span>
                  {status ? ` · ${status.sourceCount} sources` : ""}
                </p>
                {status?.error && <p className="text-sm text-destructive">{status.error}</p>}
                <p className="text-xs text-muted-foreground">
                  Open the email and choose Approve or Send feedback. This page updates
                  automatically as the agent revises or finalises the report.
                </p>
              </div>
            )}
          </section>

          <section className="panel p-6">
            <h2 className="text-lg font-semibold">3 · Archive</h2>
            {status?.status !== "completed" ? (
              <p className="mt-3 text-sm text-muted-foreground">
                The Drive upload and the Sheets row are written only after approval.
              </p>
            ) : (
              <div className="mt-4 space-y-4">
                <a
                  href={status.driveLink ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-start gap-3 rounded-lg border border-primary/40 bg-node p-4"
                >
                  <HardDrive className="mt-0.5 size-4 text-primary" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{status.pdfName}</span>
                    <span className="block truncate font-mono text-[11px] text-primary">
                      Open in Google Drive
                    </span>
                  </span>
                </a>
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
                        <tr className="border-t border-border">
                          <td className="py-1.5 pr-3">{status.createdAt.slice(0, 10)}</td>
                          <td className="truncate py-1.5 pr-3">{status.topic}</td>
                          <td className="py-1.5 pr-3">{status.revisions}</td>
                          <td className="py-1.5 text-primary">Approved</td>
                        </tr>
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

      <section className="panel mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-5">
          <div>
            <h2 className="text-lg font-semibold">Submission status</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Research, drafting and approval progress for each request.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void refreshSubmissions()}
            disabled={loadingSubmissions}
            aria-label="Refresh submissions"
            title="Refresh submissions"
          >
            <RefreshCw className={`size-4 ${loadingSubmissions ? "animate-spin" : ""}`} />
          </Button>
        </div>
        <TooltipProvider>
          <div className="overflow-x-auto">
            <Table className="min-w-[42rem]">
              <TableHeader>
                <TableRow>
                  <TableHead>Submission</TableHead>
                  <TableHead className="w-36">Created</TableHead>
                  <TableHead className="w-24 text-center">Research</TableHead>
                  <TableHead className="w-24 text-center">Drafting</TableHead>
                  <TableHead className="w-24 text-center">Approval</TableHead>
                  <TableHead className="w-32">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {submissions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      {loadingSubmissions ? "Loading submissions…" : "No submissions yet."}
                    </TableCell>
                  </TableRow>
                ) : (
                  submissions.map((submission) => (
                    <TableRow key={submission.id}>
                      <TableCell>
                        <p className="max-w-md truncate font-medium">{submission.topic}</p>
                        {submission.error && (
                          <p className="mt-1 max-w-md truncate text-xs text-destructive">
                            {submission.error}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {new Date(submission.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-center">
                        <StepStatus step="research" status={submission.status} />
                      </TableCell>
                      <TableCell className="text-center">
                        <StepStatus step="drafting" status={submission.status} />
                      </TableCell>
                      <TableCell className="text-center">
                        <StepStatus step="approval" status={submission.status} />
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={submission.status === "failed" ? "destructive" : "outline"}
                          className="whitespace-nowrap font-mono text-[10px]"
                        >
                          {submission.status.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TooltipProvider>
      </section>
    </main>
  );
}
