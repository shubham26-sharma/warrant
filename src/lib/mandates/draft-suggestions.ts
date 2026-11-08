import type { MandateDraft } from "../schemas/mandate";

export function applyAttributeSuggestion(draft: MandateDraft, suggestion: MandateDraft["suggestions"][number]): MandateDraft {
  const exists = draft.suggestions.some((item) => item.key === suggestion.key && item.value === suggestion.value);
  if (!exists) return draft;
  const alreadyRequired = draft.hardConstraints.requiredAttributes.some((item) => item.key === suggestion.key && item.value === suggestion.value);
  return {
    ...draft,
    hardConstraints: {
      ...draft.hardConstraints,
      requiredAttributes: alreadyRequired ? draft.hardConstraints.requiredAttributes : [...draft.hardConstraints.requiredAttributes, suggestion],
    },
    suggestions: draft.suggestions.filter((item) => item.key !== suggestion.key || item.value !== suggestion.value),
  };
}
