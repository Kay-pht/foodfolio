import type { Genre } from "../../generated/prisma/client.js";

export const GENRE_LABELS: Record<Genre, string> = {
  mainDish: "主菜",
  sideDish: "副菜",
  staple: "主食",
  noodles: "麺",
  soup: "スープ・汁物",
  salad: "サラダ",
  dessert: "デザート",
  other: "その他",
};

export const GENRE_VALUES = Object.keys(GENRE_LABELS) as Genre[];

export function genreFromLabel(value: string | null): Genre | null {
  if (value === null) return null;
  return (
    (Object.entries(GENRE_LABELS).find(([, label]) => label === value)?.[0] as
      Genre | undefined) ?? null
  );
}
