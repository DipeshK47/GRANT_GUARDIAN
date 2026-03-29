import "dotenv/config";

import { readFile } from "node:fs/promises";
import pdfParse from "pdf-parse";
import { env } from "../apps/orchestrator/src/config/env.js";
import { GeminiClient } from "../apps/orchestrator/src/services/gemini/client.js";

const parseArgs = () => {
  const args = process.argv.slice(2);
  let pdfPath: string | undefined;
  let mode: "auto" | "native" | "ocr" = "auto";
  let kind: "intake" | "filing" = "filing";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;

    if (arg.startsWith("--pdf-path=")) {
      pdfPath = arg.replace("--pdf-path=", "");
      continue;
    }

    if (arg === "--pdf-path") {
      pdfPath = args[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith("--mode=")) {
      const value = arg.replace("--mode=", "");
      if (value === "auto" || value === "native" || value === "ocr") {
        mode = value;
      }
      continue;
    }

    if (arg === "--mode") {
      const value = args[index + 1];
      if (value === "auto" || value === "native" || value === "ocr") {
        mode = value;
      }
      index += 1;
      continue;
    }

    if (arg.startsWith("--kind=")) {
      const value = arg.replace("--kind=", "");
      if (value === "intake" || value === "filing") {
        kind = value;
      }
      continue;
    }

    if (arg === "--kind") {
      const value = args[index + 1];
      if (value === "intake" || value === "filing") {
        kind = value;
      }
      index += 1;
    }
  }

  return { pdfPath, mode, kind };
};

const normalizeText = (text: string) =>
  text.replace(/\r/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]+/g, " ").trim();

const shouldUseIntakeOcrFallback = (text: string) => {
  const normalized = normalizeText(text);
  if (!normalized) {
    return true;
  }

  if (/prepared from an image/i.test(normalized)) {
    return true;
  }

  if (normalized.length >= 1200) {
    return false;
  }

  const alphaNumericCount = normalized.replace(/[^a-z0-9]/gi, "").length;
  return alphaNumericCount < 700;
};

const shouldUseFilingOcrFallback = (text: string) => {
  const normalized = normalizeText(text);
  if (!normalized) {
    return true;
  }

  if (/this return has been prepared from an image/i.test(normalized)) {
    return true;
  }

  if (
    normalized.length >= 2000 &&
    /schedule of contributions|recipient|grant|assistance paid during the year/i.test(normalized)
  ) {
    return false;
  }

  const alphaNumericCount = normalized.replace(/[^a-z0-9]/gi, "").length;
  return normalized.length < 1800 || alphaNumericCount < 1000;
};

const main = async () => {
  const args = parseArgs();
  if (!args.pdfPath) {
    throw new Error("Provide --pdf-path=/absolute/or/relative/path/to/file.pdf");
  }

  const pdfBuffer = await readFile(args.pdfPath);
  const geminiClient = new GeminiClient(env);

  let nativeText = "";
  try {
    const parsed = await pdfParse(pdfBuffer);
    nativeText = normalizeText(parsed.text ?? "");
  } catch (error) {
    console.warn("Native pdf-parse extraction failed.");
    console.warn(error);
  }

  const shouldUseOcr =
    args.kind === "intake"
      ? shouldUseIntakeOcrFallback(nativeText)
      : shouldUseFilingOcrFallback(nativeText);

  let ocrText = "";
  if (args.mode === "ocr" || (args.mode === "auto" && shouldUseOcr)) {
    ocrText = normalizeText(
      await geminiClient.generateTextFromInlineFiles({
        prompt:
          args.kind === "intake"
            ? `
Extract all readable text from this grant opportunity PDF.

Rules:
- Return plain text only.
- Preserve headings, deadlines, eligibility rules, application instructions, and question text when visible.
- Do not summarize or add commentary.
`
            : `
Extract the readable text from this 990-PF filing PDF.

Rules:
- Return plain text only.
- Preserve headings, schedules, recipient rows, grant purposes, and totals when visible.
- Do not summarize or add commentary.
`,
        inlineFiles: [
          {
            data: pdfBuffer,
            mimeType: "application/pdf",
          },
        ],
        maxOutputTokens: args.kind === "intake" ? 8192 : 12288,
      }),
    );
  }

  const finalText =
    args.mode === "native"
      ? nativeText
      : args.mode === "ocr"
        ? ocrText
        : ocrText.length > nativeText.length
          ? ocrText
          : nativeText;

  console.log("Grant Guardian OCR Test");
  console.log("-----------------------");
  console.log(`PDF Path: ${args.pdfPath}`);
  console.log(`Kind: ${args.kind}`);
  console.log(`Mode: ${args.mode}`);
  console.log(`Native Length: ${nativeText.length}`);
  console.log(`OCR Length: ${ocrText.length}`);
  console.log(`Would Use OCR Fallback: ${shouldUseOcr}`);
  console.log("");
  console.log("=== Extracted Text ===");
  console.log(finalText || "[no text extracted]");
};

main().catch((error) => {
  console.error("Failed to test PDF OCR.");
  console.error(error);
  process.exit(1);
});
