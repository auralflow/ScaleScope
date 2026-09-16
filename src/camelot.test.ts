import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CAMELOT_SECTORS, scoreCamelot } from "./camelot.ts";

describe("Camelot wheel", () => {
  it("contains 24 unique standard sectors", () => {
    assert.equal(CAMELOT_SECTORS.length, 24);
    assert.equal(new Set(CAMELOT_SECTORS.map((sector) => sector.code)).size, 24);
    assert.equal(CAMELOT_SECTORS.find((sector) => sector.code === "8B")?.label, "C");
    assert.equal(CAMELOT_SECTORS.find((sector) => sector.code === "8A")?.label, "Am");
    assert.equal(CAMELOT_SECTORS.find((sector) => sector.code === "5A")?.label, "Cm");
  });

  it("is neutral with no notes", () => {
    const scored = scoreCamelot([]);
    assert.ok(scored.every((sector) => sector.score === 0 && !sector.compatible));
  });

  it("marks scales that contain all selected notes", () => {
    const scored = scoreCamelot([0, 4, 7]);
    const cMajor = scored.find((sector) => sector.code === "8B");
    const fSharpMajor = scored.find((sector) => sector.code === "2B");
    assert.equal(cMajor?.score, 1);
    assert.equal(cMajor?.compatible, true);
    assert.equal(cMajor?.matched, 3);
    assert.ok((fSharpMajor?.score ?? 1) < 1);
    assert.equal(fSharpMajor?.compatible, false);
  });

  it("keeps relative major and minor Camelot sectors on the same seven notes", () => {
    const fMinor = CAMELOT_SECTORS.find((sector) => sector.code === "4A");
    const aFlatMajor = CAMELOT_SECTORS.find((sector) => sector.code === "4B");
    assert.deepEqual([...new Set(fMinor?.notes)].sort((a, b) => a - b), [0, 1, 3, 5, 7, 8, 10]);
    assert.deepEqual(
      [...new Set(fMinor?.notes)].sort((a, b) => a - b),
      [...new Set(aFlatMajor?.notes)].sort((a, b) => a - b),
    );
  });
});
