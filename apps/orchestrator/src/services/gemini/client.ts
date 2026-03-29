import {
  GoogleGenAI,
  createPartFromBase64,
  type Schema,
} from "@google/genai";
import type { AppEnv } from "../../config/env.js";

export class GeminiClient {
  private readonly client: GoogleGenAI;

  constructor(private readonly config: AppEnv) {
    this.client = new GoogleGenAI({
      apiKey: config.GEMINI_API_KEY,
    });
  }

  async generateText(prompt: string) {
    const response = await this.client.models.generateContent({
      model: this.config.GEMINI_MODEL,
      contents: prompt,
    });

    return response.text ?? "";
  }

  async generateTextFromInlineFiles(input: {
    prompt: string;
    inlineFiles: Array<{
      data: Buffer;
      mimeType: string;
    }>;
    temperature?: number;
    maxOutputTokens?: number;
  }) {
    const response = await this.client.models.generateContent({
      model: this.config.GEMINI_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { text: input.prompt },
            ...input.inlineFiles.map((file) =>
              createPartFromBase64(file.data.toString("base64"), file.mimeType),
            ),
          ],
        },
      ],
      config: {
        temperature: input.temperature ?? 0,
        maxOutputTokens: input.maxOutputTokens ?? 8192,
      },
    });

    return (response.text ?? "").trim();
  }

  async generateStructuredJson<T>(input: {
    prompt: string;
    inlineFiles?: Array<{
      data: Buffer;
      mimeType: string;
    }>;
    responseSchema?: Schema;
    temperature?: number;
    maxOutputTokens?: number;
  }) {
    const response = await this.client.models.generateContent({
      model: this.config.GEMINI_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { text: input.prompt },
            ...(input.inlineFiles ?? []).map((file) =>
              createPartFromBase64(file.data.toString("base64"), file.mimeType),
            ),
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: input.responseSchema,
        temperature: input.temperature ?? 0.1,
        maxOutputTokens: input.maxOutputTokens ?? 8192,
      },
    });

    const text = response.text ?? "";
    return JSON.parse(this.extractJsonObject(text)) as T;
  }

  private extractJsonObject(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error("Gemini returned an empty response when JSON was expected.");
    }

    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      return trimmed;
    }

    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch?.[1]) {
      return fencedMatch[1].trim();
    }

    const objectStart = trimmed.indexOf("{");
    const objectEnd = trimmed.lastIndexOf("}");
    if (objectStart >= 0 && objectEnd > objectStart) {
      return trimmed.slice(objectStart, objectEnd + 1);
    }

    const arrayStart = trimmed.indexOf("[");
    const arrayEnd = trimmed.lastIndexOf("]");
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      return trimmed.slice(arrayStart, arrayEnd + 1);
    }

    throw new Error("Gemini response did not contain a valid JSON object.");
  }
}
