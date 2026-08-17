import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const submitSchema = z.object({
  topic: z.string().trim().min(3).max(180),
  subtopics: z.string().trim().max(400).default(""),
  description: z.string().trim().max(1200).default(""),
  reviewerEmail: z.string().trim().email().max(255),
  origin: z.string().trim().url().max(300),
});

const tokenSchema = z.object({ token: z.string().uuid() });

const feedbackSchema = z.object({
  token: z.string().uuid(),
  feedback: z.string().trim().min(4).max(2000),
  origin: z.string().trim().url().max(300),
});

export const submitResearch = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => submitSchema.parse(data))
  .handler(async ({ data }) => {
    const { runInitialResearch } = await import("./pipeline.server");
    return runInitialResearch(data);
  });

export const listRequests = createServerFn({ method: "GET" }).handler(async () => {
  const { listRequests } = await import("./pipeline.server");
  return listRequests();
});

export const getRequestStatus = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { readStatus } = await import("./pipeline.server");
    return readStatus(data.id);
  });

export const getReviewRequest = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => tokenSchema.parse(data))
  .handler(async ({ data }) => {
    const { readReview } = await import("./pipeline.server");
    return readReview(data.token);
  });

export const sendReviewFeedback = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => feedbackSchema.parse(data))
  .handler(async ({ data }) => {
    const { runRevision } = await import("./pipeline.server");
    return runRevision(data);
  });

export const approveReport = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => tokenSchema.parse(data))
  .handler(async ({ data }) => {
    const { runFinalization } = await import("./pipeline.server");
    return runFinalization(data.token);
  });
