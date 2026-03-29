const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "our",
  "that",
  "the",
  "their",
  "this",
  "to",
  "we",
  "with",
  "your",
  "you",
  "will",
  "can",
  "should",
  "must",
  "not",
  "yet",
  "grant",
  "grants",
  "foundation",
  "fund",
  "funding",
  "nonprofit",
  "organization",
  "organizations",
  "program",
  "programs",
  "applicant",
  "applicants",
  "proposal",
  "proposals",
  "project",
  "projects",
]);

const GENERIC_REPLACEMENT_WORDS = [
  "program",
  "programs",
  "services",
  "support",
  "initiative",
  "work",
  "outcomes",
  "students",
  "families",
];

const STYLE_RULES = [
  {
    label: "Systems change",
    patterns: [
      "systems change",
      "systemic",
      "structural",
      "policy change",
      "root cause",
      "ecosystem",
    ],
  },
  {
    label: "Direct service",
    patterns: [
      "direct service",
      "service delivery",
      "case management",
      "wraparound",
      "tutoring",
      "mentoring",
    ],
  },
  {
    label: "Community-led",
    patterns: [
      "community led",
      "community-led",
      "community driven",
      "resident led",
      "grassroots",
      "family partnership",
    ],
  },
  {
    label: "Evidence-based",
    patterns: [
      "evidence based",
      "evidence-based",
      "data driven",
      "data-driven",
      "measurable outcomes",
      "evaluation",
      "benchmarks",
      "metrics",
    ],
  },
  {
    label: "Catalytic",
    patterns: [
      "catalytic",
      "seed funding",
      "leverage",
      "innovation",
      "scalable",
      "multiplier",
    ],
  },
  {
    label: "Capacity-building",
    patterns: [
      "capacity building",
      "capacity-building",
      "technical assistance",
      "organizational health",
      "infrastructure",
    ],
  },
  {
    label: "Place-based",
    patterns: [
      "place based",
      "place-based",
      "neighborhood",
      "regional",
      "local communities",
    ],
  },
];

export type GrantDnaTerm = {
  term: string;
  weight: number;
  occurrences: number;
};

export type GrantDnaProfile = {
  topTerms: GrantDnaTerm[];
  framingStyles: string[];
  toneSummary: string;
};

type GrantDnaSource = {
  text: string;
  weight: number;
};

type BuildGrantDnaProfileInput = {
  websiteText?: string | null;
  rfpTexts?: string[];
  annualReportTexts?: string[];
  filingPurposeTexts?: string[];
};

const normalizeText = (value?: string | null) => (value ?? "").replace(/\s+/g, " ").trim();

const tokenize = (value?: string | null) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/g)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));

const unique = <T>(values: T[]) => [...new Set(values)];

const round = (value: number, decimals = 1) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const countOccurrences = (text: string, phrase: string) => {
  if (!text || !phrase) {
    return 0;
  }

  const pattern = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "gi");
  return [...text.matchAll(pattern)].length;
};

const buildNgrams = (tokens: string[]) => {
  const grams: string[] = [];

  for (let size = 3; size >= 1; size -= 1) {
    for (let index = 0; index <= tokens.length - size; index += 1) {
      const slice = tokens.slice(index, index + size);
      if (slice.length === 0) {
        continue;
      }
      if (slice.every((token) => STOPWORDS.has(token))) {
        continue;
      }
      if (size === 1 && slice[0]!.length < 5) {
        continue;
      }
      grams.push(slice.join(" "));
    }
  }

  return grams;
};

const removeNearDuplicates = (terms: GrantDnaTerm[]) => {
  const retained: GrantDnaTerm[] = [];

  for (const candidate of terms) {
    const alreadyCovered = retained.some((term) => {
      if (term.term === candidate.term) {
        return true;
      }

      if (term.term.includes(candidate.term) && term.weight >= candidate.weight) {
        return true;
      }

      return candidate.term.includes(term.term) && candidate.weight <= term.weight;
    });

    if (!alreadyCovered) {
      retained.push(candidate);
    }
  }

  return retained;
};

const summarizeTone = (framingStyles: string[], topTerms: GrantDnaTerm[]) => {
  if (topTerms.length === 0) {
    return "Grant DNA is still thin. Run funder research and parse filings to capture a clearer vocabulary fingerprint.";
  }

  const leadTerms = topTerms.slice(0, 3).map((term) => term.term).join(", ");
  if (framingStyles.length === 0) {
    return `Language leans practical and applicant-facing, with repeated emphasis on ${leadTerms}.`;
  }

  if (framingStyles.length === 1) {
    const firstStyle = framingStyles[0];
    return `Language leans ${(firstStyle ?? "applicant-centered").toLowerCase()}, with repeated emphasis on ${leadTerms}.`;
  }

  return `Language leans ${framingStyles
    .slice(0, 2)
    .map((style) => style.toLowerCase())
    .join(" and ")}, with repeated emphasis on ${leadTerms}.`;
};

const detectFramingStyles = (sources: GrantDnaSource[]) => {
  const scores = new Map<string, number>();

  for (const rule of STYLE_RULES) {
    let score = 0;
    for (const source of sources) {
      const normalized = normalizeText(source.text).toLowerCase();
      for (const pattern of rule.patterns) {
        score += countOccurrences(normalized, pattern) * source.weight;
      }
    }

    if (score > 0) {
      scores.set(rule.label, score);
    }
  }

  return [...scores.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 3)
    .map(([label]) => label);
};

export const buildGrantDnaProfile = (
  input: BuildGrantDnaProfileInput,
): GrantDnaProfile => {
  const sources: GrantDnaSource[] = [
    normalizeText(input.websiteText)
      ? { text: normalizeText(input.websiteText), weight: 3 }
      : null,
    ...(input.rfpTexts ?? [])
      .map((text) => normalizeText(text))
      .filter(Boolean)
      .map((text) => ({ text, weight: 3 })),
    ...(input.annualReportTexts ?? [])
      .map((text) => normalizeText(text))
      .filter(Boolean)
      .map((text) => ({ text, weight: 2 })),
    ...(input.filingPurposeTexts ?? [])
      .map((text) => normalizeText(text))
      .filter(Boolean)
      .map((text) => ({ text, weight: 2 })),
  ].filter((value): value is GrantDnaSource => Boolean(value));

  const counts = new Map<string, { weight: number; occurrences: number }>();

  for (const source of sources) {
    const tokens = tokenize(source.text);
    const normalizedText = tokens.join(" ");

    for (const gram of buildNgrams(tokens)) {
      if (STOPWORDS.has(gram) || /^\d+$/.test(gram)) {
        continue;
      }
      const existing = counts.get(gram) ?? { weight: 0, occurrences: 0 };
      existing.weight += source.weight;
      existing.occurrences += countOccurrences(normalizedText, gram);
      counts.set(gram, existing);
    }
  }

  for (const rule of STYLE_RULES) {
    for (const pattern of rule.patterns) {
      let totalWeight = 0;
      let occurrences = 0;
      for (const source of sources) {
        const normalized = normalizeText(source.text).toLowerCase();
        const hits = countOccurrences(normalized, pattern);
        if (hits > 0) {
          totalWeight += hits * source.weight * 2;
          occurrences += hits;
        }
      }
      if (totalWeight > 0) {
        const existing = counts.get(pattern) ?? { weight: 0, occurrences: 0 };
        existing.weight += totalWeight;
        existing.occurrences += occurrences;
        counts.set(pattern, existing);
      }
    }
  }

  const rankedTerms = removeNearDuplicates(
    [...counts.entries()]
      .map(([term, metrics]) => ({
        term,
        weight: metrics.weight,
        occurrences: metrics.occurrences,
      }))
      .filter((term) => term.occurrences > 0)
      .sort((left, right) => {
        const weightDelta = right.weight - left.weight;
        if (weightDelta !== 0) {
          return weightDelta;
        }
        const lengthDelta = right.term.split(" ").length - left.term.split(" ").length;
        if (lengthDelta !== 0) {
          return lengthDelta;
        }
        return left.term.localeCompare(right.term);
      }),
  ).slice(0, 18);

  const framingStyles = detectFramingStyles(sources);

  return {
    topTerms: rankedTerms,
    framingStyles,
    toneSummary: summarizeTone(framingStyles, rankedTerms),
  };
};

export const readStoredGrantDnaProfile = (input: {
  relationshipHistory?: string | null;
  grantDnaTopTerms?: string | null;
  narrativeStyle?: string | null;
  toneNotes?: string | null;
}) => {
  const normalizedHistory = normalizeText(input.relationshipHistory);
  if (normalizedHistory) {
    try {
      const parsed = JSON.parse(normalizedHistory) as {
        grantDna?: {
          topTerms?: Array<{
            term?: string;
            weight?: number;
            occurrences?: number;
          }>;
          framingStyles?: string[];
          toneSummary?: string;
        };
      };
      if (parsed.grantDna?.topTerms?.length) {
        return {
          topTerms: parsed.grantDna.topTerms
            .map((term) => ({
              term: normalizeText(term.term),
              weight: typeof term.weight === "number" ? term.weight : 1,
              occurrences: typeof term.occurrences === "number" ? term.occurrences : 1,
            }))
            .filter((term) => term.term),
          framingStyles: (parsed.grantDna.framingStyles ?? []).map((style) =>
            normalizeText(style),
          ),
          toneSummary: normalizeText(parsed.grantDna.toneSummary),
        } satisfies GrantDnaProfile;
      }
    } catch {
      // ignore invalid history payloads and fall back to visible funder fields
    }
  }

  const topTerms = unique(
    normalizeText(input.grantDnaTopTerms)
      .split(",")
      .map((term) => normalizeText(term))
      .filter(Boolean),
  ).map((term) => ({ term, weight: 1, occurrences: 1 }));

  return {
    topTerms,
    framingStyles: unique(
      normalizeText(input.narrativeStyle)
        .split("·")
        .map((style) => normalizeText(style))
        .filter(Boolean),
    ),
    toneSummary: normalizeText(input.toneNotes),
  } satisfies GrantDnaProfile;
};

const detectGenericReplacementWord = (draftText: string) => {
  const normalized = normalizeText(draftText).toLowerCase();
  return GENERIC_REPLACEMENT_WORDS.find((word) =>
    new RegExp(`\\b${escapeRegExp(word)}\\b`, "i").test(normalized),
  );
};

export const computeGrantDnaAlignment = (input: {
  profile?: GrantDnaProfile | null;
  draftText?: string | null;
}) => {
  const profile = input.profile;
  const normalizedDraft = normalizeText(input.draftText);
  if (!profile || profile.topTerms.length === 0 || !normalizedDraft) {
    return {
      score: 0,
      suggestions: [] as string[],
    };
  }

  const normalizedLower = normalizedDraft.toLowerCase();
  const totalWeight = profile.topTerms.reduce((sum, term) => sum + term.weight, 0);
  const matchedWeight = profile.topTerms.reduce((sum, term) => {
    const matched = countOccurrences(normalizedLower, term.term.toLowerCase()) > 0;
    return sum + (matched ? term.weight : 0);
  }, 0);

  const score = totalWeight > 0 ? round((matchedWeight / totalWeight) * 100) : 0;
  const missingTerms = profile.topTerms.filter(
    (term) => countOccurrences(normalizedLower, term.term.toLowerCase()) === 0,
  );
  const replacementWord = detectGenericReplacementWord(normalizedDraft);

  const suggestions = missingTerms.slice(0, 2).map((term) => {
    if (replacementWord && term.term.includes(" ")) {
      return `Consider replacing generic wording like "${replacementWord}" with "${term.term}" if it matches your evidence. It appears ${term.occurrences} time${term.occurrences === 1 ? "" : "s"} in the funder's source language.`;
    }

    return `Echo "${term.term}" if it fits your evidence. It appears ${term.occurrences} time${term.occurrences === 1 ? "" : "s"} in the funder's source language.`;
  });

  return {
    score,
    suggestions,
  };
};
