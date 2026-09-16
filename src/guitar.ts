import { asPitchClass, type PitchClass } from "./music.ts";

export interface GuitarString {
  id: string;
  label: string;
  midi: number;
  gauge: number;
}

// Displayed from the highest string to the lowest, like a common scale diagram.
export const STANDARD_GUITAR_TUNING: readonly GuitarString[] = [
  { id: "high-e", label: "E4", midi: 64, gauge: 1 },
  { id: "b", label: "B3", midi: 59, gauge: 1.2 },
  { id: "g", label: "G3", midi: 55, gauge: 1.45 },
  { id: "d", label: "D3", midi: 50, gauge: 1.8 },
  { id: "a", label: "A2", midi: 45, gauge: 2.15 },
  { id: "low-e", label: "E2", midi: 40, gauge: 2.5 },
] as const;

export const GUITAR_MAX_FRET = 20;

/** Relative physical width of a fret space in 12-tone equal temperament. */
export function fretWidthRatio(fret: number): number {
  if (!Number.isInteger(fret) || fret < 1) throw new RangeError("Fret must be a positive integer");
  return 2 ** (-(fret - 1) / 12);
}

export interface GuitarPosition {
  midi: number;
  pitchClass: PitchClass;
  octave: number;
}

export function guitarPosition(stringMidi: number, fret: number): GuitarPosition {
  const midi = stringMidi + fret;
  return {
    midi,
    pitchClass: asPitchClass(midi),
    octave: Math.floor(midi / 12) - 1,
  };
}
