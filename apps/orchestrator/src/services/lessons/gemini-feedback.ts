import { Type, type Schema } from "@google/genai";
import type { AppEnv } from "../../config/env.js";
import { GeminiClient } from "../gemini/client.js";

type LoggerLike = {
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
  error: (payload: unknown, message?: string) => void;
};

export const SUPPORTED_LESSON_THEMES = [
  "Evaluation Weakness",
  "Budget Mismatch",
  "Geographic Fit",
  "Capacity Concerns",
  "Outcomes Unclear",
] as const;

export type SupportedLessonTheme = (typeof SUPPORTED_LESSON_THEMES)[number];

type GeminiFeedbackAnalysis = {
  themes: SupportedLessonTheme[];
  recommendations: string;
};

const lessonFeedbackResponseSchema: Schema = {
  type: Type.OBJECT,
  required: ["themes", "recommendations"],
  propertyOrdering: ["themes", "recommendations"],
  properties: {
    themes: {
      type: Type.ARRAY,
      items: {
        type: Type.STRING,
        description:
          "Use only these labels when relevant: Evaluation Weakness, Budget Mismatch, Geographic Fit, Capacity Concerns, Outcomes Unclear.",
      },
    },
    recommendations: {
      type: Type.STRING,
      description:
        "A short plain-English next-cycle recommendation grounded in the feedback.",
    },
  },
};

const normalizeText = (value?: string | null) => (value ?? "").replace(/\s+/g, " ").trim();

export class GeminiLessonFeedbackAnalyzer {
  private readonly logger: LoggerLike;
  private readonly geminiClient: GeminiClient;

  constructor(
    private readonly config: AppEnv,
    logger?: Partial<LoggerLike>,
  ) {
    this.geminiClient = new GeminiClient(config);
    this.logger = {
      info: logger?.info
        ? (payload, message) => logger.info?.(payload, message)
        : () => undefined,
      warn: logger?.warn
        ? (payload, message) => logger.warn?.(payload, message)
        : () => undefined,
      error: logger?.error
        ? (payload, message) => logger.error?.(payload, message)
        : () => undefined,
    };
  }

  isConfigured() {
    return normalizeText(this.config.GEMINI_API_KEY).length > 0;
  }

  async analyze(input: {
    feedbackText: string;
    funderName: string;
    opportunityTitle?: string | null;
  }): Promise<GeminiFeedbackAnalysis | null> {
    if (!this.isConfigured()) {
      return null;
    }

    const parsed = await this.geminiClient.generateStructuredJson<{
      themes?: unknown;
      recommendations?: unknown;
    }>({
      prompt: `
You analyze grant rejection feedback for nonprofits.
Return only JSON.

Rules:
- Use only these theme labels when relevant: ${SUPPORTED_LESSON_THEMES.join(", ")}
- Pick up to 3 themes.
- Recommendations should be a short, practical next-cycle recommendation in plain English.
- Do not invent facts outside the feedback.

Funder: ${input.funderName}
${input.opportunityTitle ? `Opportunity: ${input.opportunityTitle}` : ""}
Feedback: ${input.feedbackText}
`.trim(),
      responseSchema: lessonFeedbackResponseSchema,
      temperature: 0.1,
      maxOutputTokens: 240,
    });

    const themes = Array.isArray(parsed.themes)
      ? parsed.themes
          .map((item) => normalizeText(String(item)))
          .filter((item): item is SupportedLessonTheme =>
            SUPPORTED_LESSON_THEMES.includes(item as SupportedLessonTheme),
          )
      : [];
    const recommendations = normalizeText(
      typeof parsed.recommendations === "string" ? parsed.recommendations : "",
    );

    if (!recommendations) {
      this.logger.warn({ parsed }, "Gemini lesson feedback analysis returned no recommendation");
      return null;
    }

    return {
      themes,
      recommendations,
    };
  }
}
