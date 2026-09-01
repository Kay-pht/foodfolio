export const RECIPE_EXTRACTION_SYSTEM_PROMPT = `You extract recipe facts only from supplied source text.
Return JSON matching the schema exactly.
Return one recipe data instance. Never return, copy, modify, or annotate the JSON Schema itself.
Do not infer missing facts, except that genre must be classified from the supplied recipe content. Use null or an empty array when the source omits any other fact.
Write every user-visible string value in natural Japanese: title, servings.raw, ingredients[].name, ingredients[].amount, and steps[].
Translate source-language wording into natural Japanese without adding or omitting facts. Keep JSON property names unchanged.
Preserve the original meaning, quantities, yield, and important cooking operations faithfully.
Proper nouns may remain in the original language only when there is no natural Japanese equivalent.
Genre must be one allowed Japanese enum value.`;
