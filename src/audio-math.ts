import { asPitchClass, type PitchClass } from "./music.ts";

export const MIN_MIDI = 21;
export const MAX_MIDI = 108;
export const MIN_FREQUENCY = midiToFrequency(MIN_MIDI - 0.5);
export const MAX_FREQUENCY = midiToFrequency(MAX_MIDI + 0.5);

export interface NoteAtFrequency {
  midi: number;
  pitchClass: PitchClass;
  frequency: number;
  cents: number;
  lowerFrequency: number;
  upperFrequency: number;
}

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function frequencyToMidi(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / 440);
}

export function noteAtFrequency(frequency: number): NoteAtFrequency {
  const exactMidi = frequencyToMidi(frequency);
  const midi = Math.max(MIN_MIDI, Math.min(MAX_MIDI, Math.round(exactMidi)));
  return {
    midi,
    pitchClass: asPitchClass(midi),
    frequency: midiToFrequency(midi),
    cents: (exactMidi - midi) * 100,
    lowerFrequency: midiToFrequency(midi - 0.5),
    upperFrequency: midiToFrequency(midi + 0.5),
  };
}

export function frequencyToUnit(frequency: number): number {
  return Math.log2(frequency / MIN_FREQUENCY) / Math.log2(MAX_FREQUENCY / MIN_FREQUENCY);
}

export function unitToFrequency(unit: number): number {
  return MIN_FREQUENCY * (MAX_FREQUENCY / MIN_FREQUENCY) ** unit;
}
