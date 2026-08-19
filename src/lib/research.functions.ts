import { createServerFn } from "@tanstack/react-start";
import {
  feedbackSchema,
  requestIdSchema,
  runPipelineSchema,
  submitSchema,
  tokenSchema,
} from "./research.schemas";

export const submitResearch = createServerFn({ method: "POST" })
  .validator((data: unknown) => submitSchema.parse(data))
  .handler(async ({ data }) => {
    const { createRequest } = await import("./pipeline.server");
    return createRequest(data);
  });

export const runResearchPipeline = createServerFn({ method: "POST" })
  .validator((data: unknown) => runPipelineSchema.parse(data))
  .handler(async ({ data }) => {
    const { runInitialResearch } = await import("./pipeline.server");
    return runInitialResearch(data);
  });

export const listRequests = createServerFn({ method: "GET" }).handler(async () => {
  const { listRequests } = await import("./pipeline.server");
  return listRequests();
});

export const getRequestStatus = createServerFn({ method: "POST" })
  .validator((data: unknown) => requestIdSchema.parse(data))
  .handler(async ({ data }) => {
    const { readStatus } = await import("./pipeline.server");
    return readStatus(data.id);
  });

export const getReviewRequest = createServerFn({ method: "POST" })
  .validator((data: unknown) => tokenSchema.parse(data))
  .handler(async ({ data }) => {
    const { readReview } = await import("./pipeline.server");
    return readReview(data.token);
  });

export const sendReviewFeedback = createServerFn({ method: "POST" })
  .validator((data: unknown) => feedbackSchema.parse(data))
  .handler(async ({ data }) => {
    const { runRevision } = await import("./pipeline.server");
    return runRevision(data);
  });

export const approveReport = createServerFn({ method: "POST" })
  .validator((data: unknown) => tokenSchema.parse(data))
  .handler(async ({ data }) => {
    const { runFinalization } = await import("./pipeline.server");
    return runFinalization(data.token);
  });
