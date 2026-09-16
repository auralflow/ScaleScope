import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { frequencyToUnit, midiToFrequency, noteAtFrequency, unitToFrequency } from "./audio-math.ts";

function closeTo(actual: number, expected: number, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
}

describe("equal-tempered frequency mapping", () => {
  it("maps canonical pitches", () => {
    closeTo(midiToFrequency(69), 440, 1e-8);
    closeTo(midiToFrequency(60), 261.6256, 0.001);
    assert.equal(noteAtFrequency(440).midi, 69);
    assert.equal(noteAtFrequency(440).pitchClass, 9);
    assert.equal(noteAtFrequency(261.6256).midi, 60);
    assert.equal(noteAtFrequency(261.6256).pitchClass, 0);
  });

  it("uses half-semitone note boundaries", () => {
    const a4 = noteAtFrequency(440);
    closeTo(a4.lowerFrequency, midiToFrequency(68.5), 1e-8);
    closeTo(a4.upperFrequency, midiToFrequency(69.5), 1e-8);
  });

  it("round-trips the logarithmic axis", () => {
    for (const frequency of [27.5, 110, 440, 1760, 4186.009]) {
      closeTo(unitToFrequency(frequencyToUnit(frequency)), frequency, 1e-7);
    }
  });
});
