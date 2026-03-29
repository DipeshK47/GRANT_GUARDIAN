export type RequirementNormalizationInput = {
  id?: string;
  questionText?: string | null;
  requirementType?: string | null;
  wordLimit?: number | null;
};

export type NormalizedRequirementEntry = {
  sourceIds: string[];
  questionText: string;
  requirementType: string | null;
  wordLimit: number | null;
};

export const normalizeRequirementText = (text?: string | null) =>
  (text ?? "").replace(/\s+/g, " ").trim();

export const isHeadingOnlyRequirement = (text: string) => {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }

  if (normalized.length > 48) {
    return false;
  }

  if (
    /^[A-Z0-9\s/&()-]+:?$/.test(normalized) ||
    /^(eligibility|eligible grant uses|ineligible grant uses|grant uses|budget|attachments?)[:\s]*$/i.test(
      normalized,
    )
  ) {
    return true;
  }

  if (/^[A-Z][A-Za-z\s/&()-]+:$/.test(normalized) && normalized.split(/\s+/).length <= 5) {
    return true;
  }

  return false;
};

export const normalizeRequirementEntries = (
  requirements: RequirementNormalizationInput[],
): NormalizedRequirementEntry[] => {
  const merged: NormalizedRequirementEntry[] = [];

  for (let index = 0; index < requirements.length; index += 1) {
    const current = requirements[index];
    if (!current) {
      continue;
    }

    const normalizedText = normalizeRequirementText(current.questionText);
    if (!normalizedText) {
      continue;
    }

    if (isHeadingOnlyRequirement(normalizedText)) {
      let nextIndex = index + 1;
      while (nextIndex < requirements.length) {
        const nextCandidate = requirements[nextIndex];
        const nextText = normalizeRequirementText(nextCandidate?.questionText);

        if (!nextText) {
          nextIndex += 1;
          continue;
        }

        if (isHeadingOnlyRequirement(nextText)) {
          break;
        }

        merged.push({
          sourceIds: [current.id, nextCandidate?.id].filter((value): value is string => Boolean(value)),
          questionText: `${normalizedText.replace(/[:\s]+$/g, "")}: ${nextText}`,
          requirementType:
            current.requirementType ?? nextCandidate?.requirementType ?? "Narrative Question",
          wordLimit: current.wordLimit ?? nextCandidate?.wordLimit ?? null,
        });
        index = nextIndex;
        break;
      }

      continue;
    }

    merged.push({
      sourceIds: current.id ? [current.id] : [],
      questionText: normalizedText,
      requirementType: current.requirementType ?? "Narrative Question",
      wordLimit: current.wordLimit ?? null,
    });
  }

  const deduped = new Map<string, NormalizedRequirementEntry>();
  for (const requirement of merged) {
    const key = requirement.questionText
      .toLowerCase()
      .replace(
        /^(eligibility|eligible grant uses|ineligible grant uses|grant uses|budget|attachments?)\s*:\s*/i,
        "",
      );
    if (!deduped.has(key)) {
      deduped.set(key, requirement);
    }
  }

  return [...deduped.values()];
};

export const selectRetainedRequirementIds = (
  requirements: RequirementNormalizationInput[],
) => {
  const normalized = normalizeRequirementEntries(requirements);
  const fallbackIds = requirements.map((requirement) => requirement.id).filter(Boolean) as string[];
  const retainedIds: string[] = [];

  normalized.forEach((entry, index) => {
    const primaryId = entry.sourceIds.find(Boolean) ?? fallbackIds[index];
    if (primaryId && !retainedIds.includes(primaryId)) {
      retainedIds.push(primaryId);
    }
  });

  return retainedIds;
};
