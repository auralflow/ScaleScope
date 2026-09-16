import { asPitchClass, maskFromNotes, type PitchClass } from "./music.ts";

export interface CamelotSector {
  code: `${number}${"A" | "B"}`;
  number: number;
  mode: "minor" | "major";
  root: PitchClass;
  label: string;
  notes: PitchClass[];
}

export interface ScoredCamelotSector extends CamelotSector {
  score: number;
  matched: number;
  missing: PitchClass[];
  compatible: boolean;
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11] as const;
const MINOR = [0, 2, 3, 5, 7, 8, 10] as const;
const majorRoots = [11, 6, 1, 8, 3, 10, 5, 0, 7, 2, 9, 4] as const;
const minorRoots = [8, 3, 10, 5, 0, 7, 2, 9, 4, 11, 6, 1] as const;
const majorLabels = ["B", "F♯", "D♭", "A♭", "E♭", "B♭", "F", "C", "G", "D", "A", "E"];
const minorLabels = ["A♭m", "E♭m", "B♭m", "Fm", "Cm", "Gm", "Dm", "Am", "Em", "Bm", "F♯m", "C♯m"];

function sector(number: number, mode: "minor" | "major"): CamelotSector {
  const index = number - 1;
  const root = (mode === "major" ? majorRoots[index] : minorRoots[index]) as PitchClass;
  const intervals = mode === "major" ? MAJOR : MINOR;
  return {
    code: `${number}${mode === "major" ? "B" : "A"}`,
    number,
    mode,
    root,
    label: mode === "major" ? majorLabels[index] : minorLabels[index],
    notes: intervals.map((interval) => asPitchClass(root + interval)),
  };
}

export const CAMELOT_SECTORS: CamelotSector[] = Array.from({ length: 12 }, (_, index) => [
  sector(index + 1, "minor"),
  sector(index + 1, "major"),
]).flat();

export function scoreCamelot(
  selectedNotes: Iterable<number>,
  sectors: CamelotSector[] = CAMELOT_SECTORS,
): ScoredCamelotSector[] {
  const selected = [...new Set([...selectedNotes].map(asPitchClass))];
  const selectedMask = maskFromNotes(selected);
  return sectors.map((item) => {
    const sectorMask = maskFromNotes(item.notes);
    const matched = selected.filter((note) => (sectorMask & (1 << note)) !== 0).length;
    const missing = selected.filter((note) => (sectorMask & (1 << note)) === 0);
    return {
      ...item,
      matched,
      missing,
      score: selected.length === 0 ? 0 : matched / selected.length,
      compatible: selected.length > 0 && (sectorMask & selectedMask) === selectedMask,
    };
  });
}
