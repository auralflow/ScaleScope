import { MAX_MIDI, MIN_MIDI, frequencyToMidi, midiToFrequency } from "./audio-math.ts";
import { asPitchClass, type PitchClass } from "./music.ts";
import type { SpectrumResult } from "./spectrum.ts";

const DETECTION_MIN_MIDI = Math.max(MIN_MIDI, 36);
const DETECTION_MAX_MIDI = Math.min(MAX_MIDI, 96);

export interface DetectionOptions {
  sensitivity?: number;
  maxNotes?: number;
}

export interface DetectionPeak {
  midi: number;
  pitchClass: PitchClass;
  frequency: number;
  db: number;
  strength: number;
}

export interface DetectionAnalysis {
  pitchClasses: PitchClass[];
  peaks: DetectionPeak[];
}

interface BandPeak {
  db: number;
  frequency: number;
}

function bandPeak(spectrum: SpectrumResult, frequency: number, cents = 42): BandPeak {
  const ratio = 2 ** (cents / 1200);
  const start = Math.max(0, Math.floor(((frequency / ratio) * spectrum.fftSize) / spectrum.sampleRate));
  const end = Math.min(spectrum.bins.length - 1, Math.ceil(((frequency * ratio) * spectrum.fftSize) / spectrum.sampleRate));
  let peak = -90;
  let peakBin = start;
  for (let bin = start; bin <= end; bin += 1) {
    if (spectrum.bins[bin] > peak) {
      peak = spectrum.bins[bin];
      peakBin = bin;
    }
  }
  return { db: peak, frequency: (peakBin * spectrum.sampleRate) / spectrum.fftSize };
}

function amplitude(db: number, minimumDb: number): number {
  return db <= minimumDb || !Number.isFinite(db) ? 0 : 10 ** (db / 20);
}

export function analyzeSpectrumNotes(
  spectrum: SpectrumResult | null,
  options: DetectionOptions = {},
): DetectionAnalysis {
  if (!spectrum || spectrum.bins.length === 0) return { pitchClasses: [], peaks: [] };

  const sensitivityValue = Math.max(-100, Math.min(100, options.sensitivity ?? 55));
  const sensitivity = Math.max(0, sensitivityValue) / 100;
  const extraStrictness = Math.max(0, -sensitivityValue) / 100;
  const maxNotes = Math.max(1, Math.min(12, options.maxNotes ?? 12));
  const minimumDb = -36 - sensitivity * 42 + extraStrictness * 18;
  const scoreRatio = 0.18 - sensitivity * 0.165 + extraStrictness * 0.32;
  const directRatio = 0.05 - sensitivity * 0.045 + extraStrictness * 0.15;

  const noteAmplitudes = new Map<number, number>();
  const notePeaks = new Map<number, BandPeak>();
  for (let midi = DETECTION_MIN_MIDI; midi <= DETECTION_MAX_MIDI; midi += 1) {
    const peak = bandPeak(spectrum, midiToFrequency(midi));
    notePeaks.set(midi, peak);
    noteAmplitudes.set(midi, amplitude(peak.db, minimumDb));
  }

  const octaveScores = Array.from({ length: 12 }, () => [] as number[]);
  const direct = Array.from({ length: 12 }, () => 0);
  const noteSalience = new Map<number, number>();

  for (let midi = DETECTION_MIN_MIDI; midi <= DETECTION_MAX_MIDI; midi += 1) {
    const frequency = midiToFrequency(midi);
    const own = noteAmplitudes.get(midi) ?? 0;
    if (own === 0) continue;

    const left = noteAmplitudes.get(midi - 1) ?? 0;
    const right = noteAmplitudes.get(midi + 1) ?? 0;
    const localFloor = (left + right) / 2;
    const prominence = Math.max(0, own - localFloor * 0.72);
    let salience = own * 0.42 + prominence;

    // A peak that is clearly explained by a stronger lower fundamental is
    // treated as an overtone instead of another played note.
    for (let harmonic = 2; harmonic <= 6; harmonic += 1) {
      const possibleFundamental = frequency / harmonic;
      const fundamentalMidi = Math.round(frequencyToMidi(possibleFundamental));
      if (fundamentalMidi < DETECTION_MIN_MIDI || fundamentalMidi >= midi) continue;
      const centsAway = Math.abs(frequencyToMidi(possibleFundamental) - fundamentalMidi) * 100;
      const lowerAmplitude = noteAmplitudes.get(fundamentalMidi) ?? 0;
      if (centsAway <= 35 && lowerAmplitude > own * 1.15) {
        salience *= 0.08;
        break;
      }
    }

    const pitchClass = asPitchClass(midi);
    noteSalience.set(midi, salience);
    octaveScores[pitchClass].push(salience);
    direct[pitchClass] = Math.max(direct[pitchClass], own);
  }

  const scores = octaveScores.map((values) => {
    const strongest = values.sort((a, b) => b - a);
    return (strongest[0] ?? 0) + (strongest[1] ?? 0) * 0.28 + (strongest[2] ?? 0) * 0.12;
  });

  const maximum = Math.max(...scores);
  const maximumDirect = Math.max(...direct);
  if (maximum <= 0 || maximumDirect <= 0) return { pitchClasses: [], peaks: [] };

  const ranked = scores
    .map((score, pitchClass) => ({ pitchClass: pitchClass as PitchClass, score, direct: direct[pitchClass] }))
    .filter(({ score, direct: directEnergy }) => score >= maximum * scoreRatio && directEnergy >= maximumDirect * directRatio)
    .sort((a, b) => b.score - a.score || a.pitchClass - b.pitchClass)
    .slice(0, maxNotes);
  const accepted = new Set(ranked.map(({ pitchClass }) => pitchClass));
  const strongestByPitchClass = Array.from({ length: 12 }, () => 0);

  for (const [midi, salience] of noteSalience) {
    const pitchClass = asPitchClass(midi);
    strongestByPitchClass[pitchClass] = Math.max(strongestByPitchClass[pitchClass], salience);
  }

  const peaks = [...noteSalience]
    .map(([midi, salience]) => {
      const pitchClass = asPitchClass(midi);
      const peak = notePeaks.get(midi)!;
      return {
        midi,
        pitchClass,
        frequency: peak.frequency,
        db: peak.db,
        strength: strongestByPitchClass[pitchClass] > 0 ? salience / strongestByPitchClass[pitchClass] : 0,
        salience,
        directEnergy: noteAmplitudes.get(midi) ?? 0,
      };
    })
    .filter(({ pitchClass, salience, strength, directEnergy }) =>
      accepted.has(pitchClass) &&
      salience > 0 &&
      strength >= 0.16 &&
      directEnergy >= maximumDirect * directRatio,
    )
    .sort((a, b) => b.salience - a.salience || a.midi - b.midi)
    .slice(0, 30)
    .map(({ midi, pitchClass, frequency, db, strength }) => ({ midi, pitchClass, frequency, db, strength }));

  return {
    pitchClasses: ranked.map(({ pitchClass }) => pitchClass).sort((a, b) => a - b),
    peaks,
  };
}

export function detectPitchClasses(
  spectrum: SpectrumResult | null,
  maxNotesOrOptions: number | DetectionOptions = {},
): PitchClass[] {
  const options = typeof maxNotesOrOptions === "number"
    ? { maxNotes: maxNotesOrOptions }
    : maxNotesOrOptions;
  return analyzeSpectrumNotes(spectrum, options).pitchClasses;
}
