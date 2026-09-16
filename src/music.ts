export type PitchClass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export interface ScaleDefinition {
  id: string;
  name: string;
  intervals: readonly number[];
  order: number;
}

export interface ScaleMatch {
  scale: ScaleDefinition;
  roots: PitchClass[];
  noteMask: number;
  orderedNotes: PitchClass[];
  exact: boolean;
  extraCount: number;
}

export const NOTE_NAMES = [
  "C",
  "C♯/D♭",
  "D",
  "D♯/E♭",
  "E",
  "F",
  "F♯/G♭",
  "G",
  "G♯/A♭",
  "A",
  "A♯/B♭",
  "B",
] as const;

const scaleRows: ReadonlyArray<readonly [string, readonly number[]]> = [
  ["Ionian", [0, 2, 4, 5, 7, 9, 11]],
  ["Dorian", [0, 2, 3, 5, 7, 9, 10]],
  ["Phrygian", [0, 1, 3, 5, 7, 8, 10]],
  ["Lydian", [0, 2, 4, 6, 7, 9, 11]],
  ["Mixolydian", [0, 2, 4, 5, 7, 9, 10]],
  ["Aeolian", [0, 2, 3, 5, 7, 8, 10]],
  ["Locrian", [0, 1, 3, 5, 6, 8, 10]],
  ["Harmonic minor", [0, 2, 3, 5, 7, 8, 11]],
  ["Melodic minor", [0, 2, 3, 5, 7, 9, 11]],
  ["Major Blues", [0, 2, 3, 4, 7, 9]],
  ["minor Blues", [0, 3, 5, 6, 7, 10]],
  ["Diminished", [0, 2, 3, 5, 6, 8, 9, 11]],
  ["Combination Diminished", [0, 1, 3, 4, 6, 7, 9, 10]],
  ["Major Pentatonic", [0, 2, 4, 7, 9]],
  ["minor Pentatonic", [0, 3, 5, 7, 10]],
  ["Raga 1 (Bhairav)", [0, 1, 4, 5, 7, 8, 11]],
  ["Raga 2 (Gamanasrama)", [0, 1, 4, 6, 7, 9, 11]],
  ["Raga 3 (Todi)", [0, 1, 3, 6, 7, 8, 11]],
  ["Arabic", [0, 2, 4, 5, 6, 8, 10]],
  ["Spanish", [0, 1, 3, 4, 5, 7, 8, 10]],
  ["Gypsy", [0, 2, 3, 6, 7, 8, 11]],
  ["Egyptian", [0, 2, 5, 7, 10]],
  ["Hawaiian", [0, 2, 3, 7, 9]],
  ["Pelog", [0, 1, 3, 7, 8]],
  ["Japanese", [0, 1, 5, 7, 8]],
  ["Ryuku", [0, 4, 5, 7, 11]],
  ["Chinese", [0, 4, 6, 7, 11]],
  ["Bass Line", [0, 7, 10]],
  ["Whole Tone", [0, 2, 4, 6, 8, 10]],
  ["minor 3rd", [0, 3, 6, 9]],
  ["Major 3rd", [0, 4, 8]],
  ["4th Interval", [0, 5, 10]],
  ["5th Interval", [0, 7]],
  ["Octave", [0]],
] as const;

export const SCALES: ScaleDefinition[] = scaleRows.map(([name, intervals], order) => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
  name,
  intervals,
  order,
}));

export function asPitchClass(note: number): PitchClass {
  return ((note % 12) + 12) % 12 as PitchClass;
}

export function maskFromNotes(notes: Iterable<number>): number {
  let mask = 0;
  for (const note of notes) mask |= 1 << asPitchClass(note);
  return mask;
}

export function notesFromMask(mask: number): PitchClass[] {
  return Array.from({ length: 12 }, (_, note) => note as PitchClass).filter(
    (note) => (mask & (1 << note)) !== 0,
  );
}

export function transposeScale(scale: ScaleDefinition, root: PitchClass): PitchClass[] {
  return scale.intervals.map((interval) => asPitchClass(root + interval));
}

function bitCount(value: number): number {
  let count = 0;
  for (let bits = value; bits; bits &= bits - 1) count += 1;
  return count;
}

export function findScaleMatches(selectedNotes: Iterable<number>): ScaleMatch[] {
  const selectedMask = maskFromNotes(selectedNotes);
  if (selectedMask === 0) return [];

  const grouped = new Map<string, ScaleMatch>();
  for (const scale of SCALES) {
    for (let rawRoot = 0; rawRoot < 12; rawRoot += 1) {
      const root = rawRoot as PitchClass;
      const orderedNotes = transposeScale(scale, root);
      const noteMask = maskFromNotes(orderedNotes);
      if ((noteMask & selectedMask) !== selectedMask) continue;

      const key = `${scale.id}:${noteMask}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.roots.push(root);
        continue;
      }

      grouped.set(key, {
        scale,
        roots: [root],
        noteMask,
        orderedNotes,
        exact: noteMask === selectedMask,
        extraCount: bitCount(noteMask & ~selectedMask),
      });
    }
  }

  return [...grouped.values()].sort(
    (a, b) =>
      Number(b.exact) - Number(a.exact) ||
      a.extraCount - b.extraCount ||
      a.scale.order - b.scale.order ||
      a.roots[0] - b.roots[0],
  );
}

/** Every Korg scale in every one of its 12 possible roots, without grouping symmetric keys. */
export function listScaleOptions(): ScaleMatch[] {
  return SCALES.flatMap((scale) => Array.from({ length: 12 }, (_, rawRoot) => {
    const root = rawRoot as PitchClass;
    const orderedNotes = transposeScale(scale, root);
    return {
      scale,
      roots: [root],
      noteMask: maskFromNotes(orderedNotes),
      orderedNotes,
      exact: false,
      extraCount: 0,
    } satisfies ScaleMatch;
  }));
}

export function formatNoteList(notes: Iterable<number>): string {
  return [...notes].map((note) => NOTE_NAMES[asPitchClass(note)]).join(" · ");
}
