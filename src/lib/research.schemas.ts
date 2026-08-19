import { z } from "zod";

export const submitSchema = z.object({
  topic: z.string().trim().min(3).max(180),
  subtopics: z.string().trim().max(400).default(""),
  description: z.string().trim().max(1200).default(""),
  reviewerEmail: z.string().trim().email().max(255),
});

export const runPipelineSchema = z.object({
  id: z.string().uuid(),
  origin: z.string().trim().url().max(300),
});

export const tokenSchema = z.object({ token: z.string().uuid() });

export const requestIdSchema = z.object({ id: z.string().uuid() });

export const feedbackSchema = z.object({
  token: z.string().uuid(),
  feedback: z.string().trim().min(4).max(2000),
  origin: z.string().trim().url().max(300),
});