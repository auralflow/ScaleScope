import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { STANDARD_GUITAR_TUNING, fretWidthRatio, guitarPosition } from "./guitar.ts";

describe("standard guitar fretboard", () => {
  it("uses E A D G B E standard tuning", () => {
    assert.deepEqual(STANDARD_GUITAR_TUNING.map((string) => string.label), ["E4", "B3", "G3", "D3", "A2", "E2"]);
    assert.deepEqual(STANDARD_GUITAR_TUNING.map((string) => guitarPosition(string.midi, 0).pitchClass), [4, 11, 7, 2, 9, 4]);
  });

  it("maps representative fretted notes", () => {
    assert.equal(guitarPosition(64, 5).midi, 69);
    assert.equal(guitarPosition(64, 5).pitchClass, 9);
    assert.equal(guitarPosition(59, 1).pitchClass, 0);
    assert.equal(guitarPosition(55, 5).pitchClass, 0);
  });

  it("repeats every open string at the twelfth fret", () => {
    for (const string of STANDARD_GUITAR_TUNING) {
      assert.equal(guitarPosition(string.midi, 12).pitchClass, guitarPosition(string.midi, 0).pitchClass);
    }
  });

  it("uses progressively narrower fret spaces", () => {
    assert.ok(fretWidthRatio(1) > fretWidthRatio(12));
    assert.ok(fretWidthRatio(12) > fretWidthRatio(20));
    assert.ok(Math.abs(fretWidthRatio(13) / fretWidthRatio(1) - 0.5) < 1e-12);
  });
});
