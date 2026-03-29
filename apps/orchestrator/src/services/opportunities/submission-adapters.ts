import type { PortalReadinessResult } from "./portal-discovery.js";

type SubmissionMethod = "Submittable" | "Email" | "Portal" | "Other";

type SubmissionNarrativeSummary = {
  questionText: string;
  draftPreview: string;
};

type SubmissionAttachmentSummary = {
  questionText: string;
  included: boolean;
  artifactTitle?: string | null;
};

export type SubmissionAdapterKey =
  | "submittable"
  | "email"
  | "generic-portal"
  | "manual";

export type SubmissionAdapterPlan = {
  adapterKey: SubmissionAdapterKey;
  adapterLabel: string;
  targetType: "browser" | "email" | "manual";
  targetReference?: string | null;
  readyForHandoff: boolean;
  supportsBrowserLaunch: boolean;
  supportsGuidedFill: boolean;
  requiresSavedSession: boolean;
  requiresSecondHumanConfirmation: boolean;
  blockers: string[];
  warnings: string[];
  manualSteps: string[];
  emailDraft?: {
    recipientEmail?: string | null;
    subject: string;
    body: string;
    attachmentTitles: string[];
  };
};

export type SubmissionAdapterPlanInput = {
  opportunityTitle: string;
  funderName: string;
  submissionMethod: SubmissionMethod;
  portalUrl?: string | null;
  portalReadiness?: PortalReadinessResult;
  baseBlockers: string[];
  narratives: SubmissionNarrativeSummary[];
  attachments: SubmissionAttachmentSummary[];
};

const normalizeText = (value?: string | null) =>
  (value ?? "").replace(/\s+/g, " ").trim();

const shortLabel = (value?: string | null, fallback = "Requirement") => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return fallback;
  }

  return normalized.length > 90 ? `${normalized.slice(0, 87)}...` : normalized;
};

const parseMailtoRecipient = (target?: string | null) => {
  const normalized = normalizeText(target);
  if (!normalized.toLowerCase().startsWith("mailto:")) {
    return null;
  }

  const withoutScheme = normalized.replace(/^mailto:/i, "");
  const [recipient] = withoutScheme.split("?");
  return normalizeText(recipient) || null;
};

const buildEmailDraft = (input: SubmissionAdapterPlanInput) => {
  const recipientEmail = parseMailtoRecipient(input.portalUrl);
  const attachmentTitles = input.attachments
    .filter((attachment) => attachment.included)
    .map((attachment) => attachment.artifactTitle || shortLabel(attachment.questionText))
    .filter(Boolean);
  const firstNarrative = input.narratives[0]?.draftPreview
    ? `Primary narrative summary: ${input.narratives[0].draftPreview}`
    : "Narrative responses are attached in the prepared submission packet.";

  return {
    recipientEmail,
    subject: `Grant application: ${input.opportunityTitle}`,
    body: [
      `Hello ${input.funderName} team,`,
      "",
      `Attached is our application for ${input.opportunityTitle}.`,
      "",
      firstNarrative,
      "",
      `Attachments included: ${attachmentTitles.length > 0 ? attachmentTitles.join(", ") : "Prepared submission packet attachments"}.`,
      "",
      "Thank you,",
      "[Grant Guardian Human Reviewer]",
    ].join("\n"),
    attachmentTitles,
  };
};

export const buildSubmissionAdapterPlan = (
  input: SubmissionAdapterPlanInput,
): SubmissionAdapterPlan => {
  const baseBlockers = [
    ...input.baseBlockers,
    ...(input.portalReadiness?.blockers ?? []),
  ];
  const readinessWarnings = input.portalReadiness?.warnings ?? [];
  const readinessSteps = input.portalReadiness?.recommendedActions ?? [];

  if (input.submissionMethod === "Submittable") {
    const targetReference =
      normalizeText(input.portalReadiness?.preferredBrowserUrl) || normalizeText(input.portalUrl);
    const blockers = [...baseBlockers];
    if (!targetReference) {
      blockers.push("Submittable portal URL is missing, so browser handoff cannot be prepared safely.");
    }

    return {
      adapterKey: "submittable",
      adapterLabel: "Submittable",
      targetType: "browser",
      targetReference: targetReference || null,
      readyForHandoff: blockers.length === 0,
      supportsBrowserLaunch: true,
      supportsGuidedFill: true,
      requiresSavedSession: true,
      requiresSecondHumanConfirmation: true,
      blockers,
      warnings: readinessWarnings,
      manualSteps: [
        "Open the Submittable application and confirm the correct opportunity is loaded.",
        "Review every auto-filled narrative and upload before continuing.",
        "Keep the final submit click human-controlled even after browser handoff.",
        ...readinessSteps,
      ],
    };
  }

  if (input.submissionMethod === "Portal") {
    const targetReference =
      normalizeText(input.portalReadiness?.preferredBrowserUrl) || normalizeText(input.portalUrl);
    const blockers = [...baseBlockers];
    if (!targetReference) {
      blockers.push("Portal URL is missing, so guided browser handoff cannot be prepared yet.");
    }

    return {
      adapterKey: "generic-portal",
      adapterLabel: "Generic Portal",
      targetType: "browser",
      targetReference: targetReference || null,
      readyForHandoff: blockers.length === 0,
      supportsBrowserLaunch: true,
      supportsGuidedFill: true,
      requiresSavedSession: false,
      requiresSecondHumanConfirmation: true,
      blockers,
      warnings: [
        ...readinessWarnings,
        "Generic portal handoff is supported, but site-specific field behavior may still require more human review than a Submittable flow.",
      ],
      manualSteps: [
        "Open the grant portal and complete any login or eligibility steps manually.",
        "Use guided fill where field matches are confident, then review every field before continuing.",
        "Keep the final submit click human-controlled.",
        ...readinessSteps,
      ],
    };
  }

  if (input.submissionMethod === "Email") {
    const emailDraft = buildEmailDraft(input);
    const blockers = [...baseBlockers];
    if (!emailDraft.recipientEmail) {
      blockers.push("Submission method is Email, but no recipient address was discovered yet.");
    }

    return {
      adapterKey: "email",
      adapterLabel: "Email Submission",
      targetType: "email",
      targetReference: emailDraft.recipientEmail ? `mailto:${emailDraft.recipientEmail}` : null,
      readyForHandoff: blockers.length === 0,
      supportsBrowserLaunch: false,
      supportsGuidedFill: false,
      requiresSavedSession: false,
      requiresSecondHumanConfirmation: false,
      blockers,
      warnings: readinessWarnings,
      manualSteps: [
        "Review the prepared subject line and message body before sending.",
        "Attach the staged documents and any final narrative exports from the packet.",
        "Send from the organization mailbox after a human final review.",
        ...readinessSteps,
      ],
      emailDraft,
    };
  }

  return {
    adapterKey: "manual",
    adapterLabel: "Manual Workflow",
    targetType: "manual",
    targetReference: normalizeText(input.portalUrl) || null,
    readyForHandoff: false,
    supportsBrowserLaunch: false,
    supportsGuidedFill: false,
    requiresSavedSession: false,
    requiresSecondHumanConfirmation: false,
    blockers: [
      ...baseBlockers,
      "No supported submission adapter is available yet for this opportunity.",
    ],
    warnings: readinessWarnings,
    manualSteps: [
      "Use the assembled packet as a manual checklist.",
      "Open the funder instructions and complete the submission outside browser automation.",
      "Record the final submission outcome manually.",
      ...readinessSteps,
    ],
  };
};
