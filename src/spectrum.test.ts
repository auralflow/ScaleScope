import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FFT_HOP,
  FFT_SIZE,
  LIVE_SMOOTHING_FRAME_COUNT,
  playbackLikeSelection,
} from "./spectrum.ts";

describe("playback-like spectrum selection", () => {
  it("uses a trailing FFT window plus a short smoothing history", () => {
    const sampleRate = 44_100;
    const selection = playbackLikeSelection(10, 20, sampleRate);
    const expectedLookback = (FFT_SIZE + (LIVE_SMOOTHING_FRAME_COUNT - 1) * FFT_HOP) / sampleRate;

    assert.equal(selection.end, 10);
    assert.ok(Math.abs(selection.start - (10 - expectedLookback)) < 1e-9);
  });

  it("clamps the playback-like window at the start of a file", () => {
    const selection = playbackLikeSelection(0, 20, 44_100);

    assert.equal(selection.start, 0);
    assert.equal(selection.end, 0.1);
  });
});
