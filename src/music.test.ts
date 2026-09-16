import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SCALES, findScaleMatches, listScaleOptions, maskFromNotes, transposeScale } from "./music.ts";

const EXPECTED_C: Record<string, number[]> = {
  Chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  Ionian: [0, 2, 4, 5, 7, 9, 11],
  Dorian: [0, 2, 3, 5, 7, 9, 10],
  Phrygian: [0, 1, 3, 5, 7, 8, 10],
  Lydian: [0, 2, 4, 6, 7, 9, 11],
  Mixolydian: [0, 2, 4, 5, 7, 9, 10],
  Aeolian: [0, 2, 3, 5, 7, 8, 10],
  Locrian: [0, 1, 3, 5, 6, 8, 10],
  "Harmonic minor": [0, 2, 3, 5, 7, 8, 11],
  "Melodic minor": [0, 2, 3, 5, 7, 9, 11],
  "Major Blues": [0, 2, 3, 4, 7, 9],
  "minor Blues": [0, 3, 5, 6, 7, 10],
  Diminished: [0, 2, 3, 5, 6, 8, 9, 11],
  "Combination Diminished": [0, 1, 3, 4, 6, 7, 9, 10],
  "Major Pentatonic": [0, 2, 4, 7, 9],
  "minor Pentatonic": [0, 3, 5, 7, 10],
  "Raga 1 (Bhairav)": [0, 1, 4, 5, 7, 8, 11],
  "Raga 2 (Gamanasrama)": [0, 1, 4, 6, 7, 9, 11],
  "Raga 3 (Todi)": [0, 1, 3, 6, 7, 8, 11],
  Arabic: [0, 2, 4, 5, 6, 8, 10],
  Spanish: [0, 1, 3, 4, 5, 7, 8, 10],
  Gypsy: [0, 2, 3, 6, 7, 8, 11],
  Egyptian: [0, 2, 5, 7, 10],
  Hawaiian: [0, 2, 3, 7, 9],
  Pelog: [0, 1, 3, 7, 8],
  Japanese: [0, 1, 5, 7, 8],
  Ryuku: [0, 4, 5, 7, 11],
  Chinese: [0, 4, 6, 7, 11],
  "Bass Line": [0, 7, 10],
  "Whole Tone": [0, 2, 4, 6, 8, 10],
  "minor 3rd": [0, 3, 6, 9],
  "Major 3rd": [0, 4, 8],
  "4th Interval": [0, 5, 10],
  "5th Interval": [0, 7],
  Octave: [0],
};

describe("Korg scales", () => {
  it("contains the exact 35 C definitions", () => {
    assert.equal(SCALES.length, 35);
    assert.equal(Object.keys(EXPECTED_C).length, 35);
    for (const scale of SCALES) assert.deepEqual(scale.intervals, EXPECTED_C[scale.name]);
  });

  it("transposes every definition through all 12 roots", () => {
    for (const scale of SCALES) {
      for (let root = 0; root < 12; root += 1) {
        const notes = transposeScale(scale, root as 0);
        assert.equal(notes.length, scale.intervals.length);
        assert.equal(notes[0], root);
        assert.equal(new Set(notes).size, notes.length);
      }
    }
  });

  it("finds representative exact transpositions", () => {
    const cases = [
      ["Ionian", 0, [0, 2, 4, 5, 7, 9, 11]],
      ["Ionian", 2, [2, 4, 6, 7, 9, 11, 1]],
      ["Dorian", 0, [0, 2, 3, 5, 7, 9, 10]],
      ["5th Interval", 0, [0, 7]],
      ["Octave", 0, [0]],
    ] as const;

    for (const [name, root, notes] of cases) {
      const match = findScaleMatches(notes).find(
        (candidate) => candidate.scale.name === name && candidate.roots.includes(root),
      );
      assert.equal(match?.exact, true);
    }
  });

  it("keeps subset matches and sorts exact matches first", () => {
    const matches = findScaleMatches([0, 4, 7]);
    assert.ok(matches.length > 0);
    const firstNonExact = matches.findIndex((match) => !match.exact);
    assert.ok(matches.slice(0, firstNonExact).every((match) => match.exact));
    assert.ok(matches.every((match) => (match.noteMask & maskFromNotes([0, 4, 7])) === maskFromNotes([0, 4, 7])));
  });

  it("groups symmetric roots with identical pitch sets", () => {
    const chromatic = findScaleMatches(EXPECTED_C.Chromatic).find((match) => match.scale.name === "Chromatic");
    const wholeTone = findScaleMatches(EXPECTED_C["Whole Tone"]).find((match) => match.scale.name === "Whole Tone");
    const minorThird = findScaleMatches(EXPECTED_C["minor 3rd"]).find((match) => match.scale.name === "minor 3rd");
    assert.equal(chromatic?.roots.length, 12);
    assert.deepEqual(wholeTone?.roots, [0, 2, 4, 6, 8, 10]);
    assert.deepEqual(minorThird?.roots, [0, 3, 6, 9]);
  });

  it("lists every scale and root when browsing without selected notes", () => {
    const options = listScaleOptions();
    assert.equal(options.length, 35 * 12);
    const dIonian = options.find((option) => option.scale.name === "Ionian" && option.roots[0] === 2);
    assert.deepEqual(dIonian?.orderedNotes, [2, 4, 6, 7, 9, 11, 1]);
  });
});
