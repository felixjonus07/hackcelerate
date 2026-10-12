/**
 * Text normalisation for the validator. A model that has been talked into writing a forbidden word can
 * hide it with zero-width characters, accents, look-alike letters or substitutions, so the forbidden
 * and privacy checks run on a canonical form of each sentence.
 */

/** Cyrillic and Greek letters that look like Latin ones. */
const CONFUSABLES: Record<string, string> = {
  а: "a",
  е: "e",
  о: "o",
  р: "p",
  с: "c",
  у: "y",
  х: "x",
  і: "i",
  ј: "j",
  ѕ: "s",
  ԁ: "d",
  һ: "h",
  к: "k",
  м: "m",
  н: "h",
  т: "t",
  в: "b",
  α: "a",
  ο: "o",
  ε: "e",
  ν: "v",
  ι: "i",
  κ: "k",
  ρ: "p",
  τ: "t",
  υ: "u",
  χ: "x",
  β: "b",
  η: "n",
  μ: "u",
};

/** Lower-case Latin text with accents, zero-width characters and look-alike letters folded away. */
export function canon(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\p{M}\p{Cf}]/gu, "")
    .toLowerCase()
    .replace(/[Ͱ-ϿЀ-ӿ]/g, (c) => CONFUSABLES[c] ?? c);
}

/** `canon` plus the common character swaps (l4zy, l@zy, dr1fting) used to slip past a word list. */
export function leetFold(text: string): string {
  return canon(text)
    .replace(/[@4]/g, "a")
    .replace(/[$5]/g, "s")
    .replace(/[10!|]/g, (c) => (c === "0" ? "o" : c === "1" ? "i" : "i"))
    .replace(/3/g, "e")
    .replace(/7/g, "t");
}

/** Share of letters outside the Latin script: narratives are English, and other scripts cannot be checked. */
export function nonLatinLetters(text: string): number {
  return (text.match(/\p{L}/gu) ?? []).filter((c) => !/\p{Script=Latin}/u.test(c)).length;
}
