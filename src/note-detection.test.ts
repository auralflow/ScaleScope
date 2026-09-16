import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { midiToFrequency } from "./audio-math.ts";
import { analyzeSpectrumNotes, detectPitchClasses } from "./note-detection.ts";
import { PINK_TILT_DB_PER_OCTAVE, writeTiltCompensatedBins, type SpectrumResult } from "./spectrum.ts";

const SAMPLE_RATE = 44_100;
const FFT_SIZE = 32_768;

function spectrumWithPeaks(peaks: Array<[frequency: number, db: number]>): SpectrumResult {
  const bins = new Float32Array(FFT_SIZE / 2 + 1).fill(-90);
  for (const [frequency, db] of peaks) {
    const center = Math.round((frequency * FFT_SIZE) / SAMPLE_RATE);
    for (let offset = -2; offset <= 2; offset += 1) {
      if (center + offset >= 0 && center + offset < bins.length) bins[center + offset] = db - Math.abs(offset) * 3;
    }
  }
  return { jobId: 1, bins, sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE };
}

describe("spectrum note detection", () => {
  it("detects A4", () => {
    assert.deepEqual(detectPitchClasses(spectrumWithPeaks([[440, 0]])), [9]);
  });

  it("detects a C major triad", () => {
    const spectrum = spectrumWithPeaks([60, 64, 67].map((midi) => [midiToFrequency(midi), 0]));
    assert.deepEqual(detectPitchClasses(spectrum), [0, 4, 7]);
  });

  it("keeps quieter chord tones below a dominant bass peak", () => {
    const spectrum = spectrumWithPeaks([
      [midiToFrequency(48), 0],
      [midiToFrequency(52), -14],
      [midiToFrequency(55), -20],
    ]);
    assert.deepEqual(detectPitchClasses(spectrum), [0, 4, 7]);
  });

  it("does not mistake quieter harmonics for played notes", () => {
    const fundamental = midiToFrequency(48);
    const spectrum = spectrumWithPeaks([
      [fundamental, 0],
      [fundamental * 2, -5],
      [fundamental * 3, -10],
      [fundamental * 4, -14],
      [fundamental * 5, -18],
    ]);
    assert.deepEqual(detectPitchClasses(spectrum), [0]);
  });

  it("exposes the same candidates that Detect selects", () => {
    const analysis = analyzeSpectrumNotes(spectrumWithPeaks([
      [midiToFrequency(60), 0],
      [midiToFrequency(64), -12],
      [midiToFrequency(67), -18],
    ]), { sensitivity: 55 });
    assert.deepEqual(analysis.pitchClasses, [0, 4, 7]);
    assert.ok(analysis.peaks.length >= analysis.pitchClasses.length);
    assert.deepEqual(
      [...new Set(analysis.peaks.map(({ pitchClass }) => pitchClass))].sort((a, b) => a - b),
      analysis.pitchClasses,
    );
  });

  it("adds more quiet candidates as sensitivity rises", () => {
    const spectrum = spectrumWithPeaks([
      [midiToFrequency(60), 0],
      [midiToFrequency(64), -34],
    ]);
    assert.deepEqual(detectPitchClasses(spectrum, { sensitivity: 0 }), [0]);
    assert.deepEqual(detectPitchClasses(spectrum, { sensitivity: 100 }), [0, 4]);
  });

  it("extends sensitivity below the former zero point", () => {
    const spectrum = spectrumWithPeaks([
      [midiToFrequency(60), 0],
      [midiToFrequency(64), -8],
    ]);
    assert.deepEqual(detectPitchClasses(spectrum, { sensitivity: 0 }), [0, 4]);
    assert.deepEqual(detectPitchClasses(spectrum, { sensitivity: -100 }), [0]);
  });

  it("flattens a -3.01 dB per octave pink-noise slope", () => {
    const bins = new Float32Array(FFT_SIZE / 2 + 1).fill(-90);
    for (let bin = 1; bin < bins.length; bin += 1) {
      const frequency = (bin * SAMPLE_RATE) / FFT_SIZE;
      bins[bin] = Math.max(-90, -PINK_TILT_DB_PER_OCTAVE * Math.log2(frequency / 55));
    }
    const source: SpectrumResult = { jobId: 1, bins, sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE };
    const compensated = new Float32Array(bins.length);
    writeTiltCompensatedBins(source, compensated, PINK_TILT_DB_PER_OCTAVE);
    const at = (frequency: number) => compensated[Math.round((frequency * FFT_SIZE) / SAMPLE_RATE)];
    assert.ok(Math.abs(at(110) - at(440)) < 0.15);
    assert.ok(Math.abs(at(440) - at(1760)) < 0.15);
  });
});
