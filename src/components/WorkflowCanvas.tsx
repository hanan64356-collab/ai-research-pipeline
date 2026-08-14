import { cn } from "@/lib/utils";
import {
  FileText,
  Globe,
  Sparkles,
  Mail,
  GitBranch,
  RefreshCcw,
  FileDown,
  HardDrive,
  Table2,
  CheckCircle2,
} from "lucide-react";

export type StageId =
  | "form"
  | "tavily"
  | "llm"
  | "mail"
  | "switch"
  | "revise"
  | "pdf"
  | "drive"
  | "sheet"
  | "done";

const NODES: { id: StageId; label: string; sub: string; icon: typeof FileText }[] = [
  { id: "form", label: "Form Trigger", sub: "topic · subtopics · email", icon: FileText },
  { id: "tavily", label: "Tavily Search", sub: "HTTP Request", icon: Globe },
  { id: "llm", label: "Build HTML Report", sub: "AI Agent", icon: Sparkles },
  { id: "mail", label: "Send Draft", sub: "Gmail", icon: Mail },
  { id: "switch", label: "Read Reply", sub: "Switch: APPROVED / FEEDBACK", icon: GitBranch },
  { id: "revise", label: "Revise Report", sub: "AI Agent · loop", icon: RefreshCcw },
  { id: "pdf", label: "HTML → PDF", sub: "HTTP Request", icon: FileDown },
  { id: "drive", label: "Upload PDF", sub: "Google Drive", icon: HardDrive },
  { id: "sheet", label: "Log Row", sub: "Google Sheets", icon: Table2 },
  { id: "done", label: "Send \u201cIt\u2019s done\u201d", sub: "Gmail", icon: CheckCircle2 },
];

export function WorkflowCanvas({
  active,
  completed,
}: {
  active: StageId | null;
  completed: StageId[];
}) {
  return (
    <div className="panel overflow-x-auto p-5">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h3 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          Workflow execution
        </h3>
        <span className="font-mono text-xs text-muted-foreground">
          {completed.length}/{NODES.length} nodes
        </span>
      </div>
      <ol className="flex min-w-max items-stretch gap-2">
        {NODES.map((node, i) => {
          const isDone = completed.includes(node.id);
          const isActive = active === node.id;
          const Icon = node.icon;
          return (
            <li key={node.id} className="flex items-center gap-2">
              <div
                className={cn(
                  "w-[9.5rem] rounded-lg border bg-node p-3 transition-colors duration-300",
                  isDone && "border-primary/60",
                  isActive && "border-primary node-active",
                  !isDone && !isActive && "border-border opacity-60",
                )}
              >
                <Icon
                  className={cn(
                    "mb-2 size-4",
                    isActive || isDone ? "text-primary" : "text-muted-foreground",
                  )}
                />
                <p className="text-xs leading-tight font-semibold text-node-foreground">
                  {node.label}
                </p>
                <p className="mt-1 font-mono text-[10px] leading-tight text-muted-foreground">
                  {node.sub}
                </p>
              </div>
              {i < NODES.length - 1 && (
                <span
                  aria-hidden
                  className={cn(
                    "h-px w-4 shrink-0",
                    isDone ? "rule-gradient" : "bg-border",
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export const ALL_STAGES = NODES.map((n) => n.id);
