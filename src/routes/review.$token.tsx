import { createFileRoute, useParams, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, HardDrive, Loader2, Mail, RefreshCcw } from "lucide-react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { approveReport, getReviewRequest, sendReviewFeedback } from "@/lib/research.functions";

const searchSchema = z.object({ approve: z.string().optional() });

export const Route = createFileRoute("/review/$token")({
  validateSearch: (search) => searchSchema.parse(search),
  head: () => ({
    meta: [
      { title: "Review a research draft — AI Research Pipeline" },
      {
        name: "description",
        content:
          "Read the AI-drafted research report, send revision notes back to the agent, or approve it so the PDF is archived to Drive and logged in Sheets.",
      },
      { property: "og:title", content: "Review a research draft — AI Research Pipeline" },
      {
        property: "og:description",
        content: "Approve the draft or send feedback and the agent will revise and email you again.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ReviewPage,
  errorComponent: () => (
    <Shell>
      <p className="text-sm text-muted-foreground">This review link is not valid any more.</p>
    </Shell>
  ),
  notFoundComponent: () => (
    <Shell>
      <p className="text-sm text-muted-foreground">This review link was not found.</p>
    </Shell>
  ),
});

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-14 sm:px-6">
      <h1 className="text-3xl font-bold">Research draft review</h1>
      <div className="mt-4 h-px w-40 rule-gradient" />
      <div className="mt-8 space-y-6">{children}</div>
    </main>
  );
}

type Review = Awaited<ReturnType<typeof getReviewRequest>>;

function ReviewPage() {
  const { token } = useParams({ from: "/review/$token" });
  const { approve } = useSearch({ from: "/review/$token" });
  const load = useServerFn(getReviewRequest);
  const revise = useServerFn(sendReviewFeedback);
  const finalize = useServerFn(approveReport);

  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"revise" | "approve" | null>(null);
  const [feedback, setFeedback] = useState("");
  const [autoRan, setAutoRan] = useState(false);
  const origin = useMemo(
    () => (typeof window === "undefined" ? "" : window.location.origin),
    [],
  );

  const refresh = async () => {
    try {
      setReview(await load({ data: { token } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "This review link is not valid.");
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (autoRan || approve !== "1" || !review || review.status !== "awaiting_review") return;
    setAutoRan(true);
    void onApprove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approve, review, autoRan]);

  async function onApprove() {
    setBusy("approve");
    setError(null);
    try {
      await finalize({ data: { token } });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval failed.");
    } finally {
      setBusy(null);
    }
  }

  async function onRevise() {
    if (feedback.trim().length < 4) return;
    setBusy("revise");
    setError(null);
    try {
      await revise({ data: { token, feedback: feedback.trim(), origin } });
      setFeedback("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The revision failed.");
    } finally {
      setBusy(null);
    }
  }

  if (error && !review) {
    return (
      <Shell>
        <p className="text-sm text-destructive">{error}</p>
      </Shell>
    );
  }

  if (!review) {
    return (
      <Shell>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading the draft…
        </p>
      </Shell>
    );
  }

  const done = review.status === "completed";

  return (
    <Shell>
      <section className="panel p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{review.topic}</h2>
          <div className="flex items-center gap-2">
            {review.revisions > 0 && <Badge variant="secondary">Revision {review.revisions}</Badge>}
            <Badge variant="outline" className="font-mono text-xs">
              {review.status.replace(/_/g, " ")}
            </Badge>
          </div>
        </div>
        {review.subtopics && (
          <p className="mt-2 font-mono text-[11px] text-muted-foreground">{review.subtopics}</p>
        )}
        <div
          className="mt-5 max-h-[32rem] overflow-y-auto rounded-lg border border-border bg-node p-5 text-sm leading-relaxed [&_a]:text-primary [&_h1]:mb-2 [&_h1]:font-display [&_h1]:text-xl [&_h1]:font-bold [&_h2]:mt-4 [&_h2]:mb-1 [&_h2]:font-display [&_h2]:text-sm [&_h2]:font-semibold [&_li]:mb-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:text-muted-foreground [&_table]:mt-2 [&_table]:w-full [&_table]:text-left [&_td]:border-t [&_td]:border-border [&_td]:py-1 [&_td]:pr-3 [&_th]:py-1 [&_th]:pr-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:text-muted-foreground"
          dangerouslySetInnerHTML={{ __html: review.reportHtml ?? "<p>No draft yet.</p>" }}
        />

        {review.sources.length > 0 && (
          <p className="mt-3 font-mono text-[11px] text-muted-foreground">
            {review.sources.length} web sources used
          </p>
        )}
      </section>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {done ? (
        <section className="panel p-6">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <CheckCircle2 className="size-4 text-primary" /> Approved and archived
          </p>
          {review.driveLink && (
            <a
              href={review.driveLink}
              target="_blank"
              rel="noreferrer"
              className="mt-4 flex items-start gap-3 rounded-lg border border-primary/40 bg-node p-4"
            >
              <HardDrive className="mt-0.5 size-4 text-primary" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{review.pdfName}</span>
                <span className="block truncate font-mono text-[11px] text-primary">
                  Open in Google Drive
                </span>
              </span>
            </a>
          )}
          <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Mail className="size-4 text-primary" /> A confirmation email has been sent.
          </p>
        </section>
      ) : review.status === "awaiting_review" ? (
        <section className="panel p-6">
          <h2 className="text-lg font-semibold">Your decision</h2>
          <div className="mt-4 space-y-3">
            <Label htmlFor="fb">Revision notes</Label>
            <Textarea
              id="fb"
              rows={3}
              placeholder="e.g. Add a 5-year cost table and cite 2026 figures."
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={busy !== null || feedback.trim().length < 4}
                onClick={onRevise}
              >
                {busy === "revise" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCcw className="size-4" />
                )}
                Send feedback
              </Button>
              <Button disabled={busy !== null} onClick={onApprove}>
                {busy === "approve" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
                Approve
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Feedback sends the draft back to the agent, which revises it and emails you a new
              version. Approving renders the PDF, uploads it to Drive and logs a row in Sheets.
            </p>
          </div>
        </section>
      ) : (
        <section className="panel p-6">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> The agent is working on this report
            ({review.status.replace(/_/g, " ")}). Refresh in a moment.
          </p>
        </section>
      )}

      {review.feedback.length > 0 && (
        <section className="panel p-6">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Feedback history
          </p>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
            {review.feedback.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ol>
        </section>
      )}
    </Shell>
  );
}
