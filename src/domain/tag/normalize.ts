export function normalizeTagName(value: string): {
  name: string;
  normalizedName: string;
} {
  const name = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (name.length < 1 || [...name].length > 30)
    throw new Error("Tag name must be 1 to 30 characters");
  return {
    name,
    normalizedName: name.replace(/[A-Z]/g, (letter) => letter.toLowerCase()),
  };
}
