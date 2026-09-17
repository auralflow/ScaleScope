export interface AudioSelection {
  start: number;
  end: number;
}

export interface SpectrumResult {
  jobId: number;
  bins: Float32Array;
  sampleRate: number;
  fftSize: number;
}

export interface SpectrumWorkerRequest {
  jobId: number;
  channels: Float32Array[];
  sampleRate: number;
  fftSize: number;
  frameCount: number;
  frameWeights?: Float32Array;
}

export interface SpectrumWorkerResponse {
  jobId: number;
  bins: Float32Array;
  sampleRate: number;
  fftSize: number;
}

export const FFT_SIZE = 32768;
export const FFT_HOP = 8192;
export const MAX_FRAMES = 512;
export const LIVE_SMOOTHING_TIME_CONSTANT = 0.68;
export const LIVE_SMOOTHING_FRAME_COUNT = 8;
export const PINK_TILT_DB_PER_OCTAVE = 10 * Math.log10(2);

export interface SpectrumPreparationOptions {
  playbackLike?: boolean;
}

/**
 * Writes a display/detection spectrum compensated against the canonical pink-noise
 * slope. Positive slope values lift higher octaves, then the result is normalized
 * back to a relative -90…0 dB range without modifying the source FFT data.
 */
export function writeTiltCompensatedBins(
  source: SpectrumResult,
  target: Float32Array,
  slopeDbPerOctave: number,
  pivotFrequency = 440,
): void {
  if (target.length !== source.bins.length) {
    throw new RangeError("Spectrum target must have the same number of bins as its source.");
  }

  const minFrequency = 27.5 / 2 ** (0.5 / 12);
  const maxFrequency = 4186.009044809578 * 2 ** (0.5 / 12);
  const firstBin = Math.max(1, Math.floor((minFrequency * source.fftSize) / source.sampleRate));
  const lastBin = Math.min(source.bins.length - 1, Math.ceil((maxFrequency * source.fftSize) / source.sampleRate));
  let rawPeak = -Infinity;
  let compensatedPeak = -Infinity;

  for (let bin = firstBin; bin <= lastBin; bin += 1) {
    const raw = source.bins[bin];
    if (!Number.isFinite(raw)) continue;
    rawPeak = Math.max(rawPeak, raw);
    const frequency = (bin * source.sampleRate) / source.fftSize;
    compensatedPeak = Math.max(compensatedPeak, raw + slopeDbPerOctave * Math.log2(frequency / pivotFrequency));
  }

  if (!Number.isFinite(compensatedPeak) || rawPeak <= -89.5) {
    target.fill(-90);
    return;
  }

  for (let bin = 0; bin < source.bins.length; bin += 1) {
    const raw = source.bins[bin];
    const frequency = (bin * source.sampleRate) / source.fftSize;
    const compensation = bin > 0 && Number.isFinite(raw)
      ? slopeDbPerOctave * Math.log2(frequency / pivotFrequency)
      : 0;
    target[bin] = Number.isFinite(raw)
      ? Math.max(-90, Math.min(0, raw + compensation - compensatedPeak))
      : -90;
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export async function prepareSpectrumFrames(
  buffer: AudioBuffer,
  selection: AudioSelection,
  signal?: AbortSignal,
  options: SpectrumPreparationOptions = {},
): Promise<{ channels: Float32Array[]; frameCount: number; frameWeights?: Float32Array }> {
  const startSample = Math.max(0, Math.floor(selection.start * buffer.sampleRate));
  const endSample = Math.min(buffer.length, Math.ceil(selection.end * buffer.sampleRate));
  const selectionLength = Math.max(1, endSample - startSample);
  const maxStart = Math.max(startSample, endSample - FFT_SIZE);
  const naturalCount = Math.max(1, Math.floor(Math.max(0, selectionLength - FFT_SIZE) / FFT_HOP) + 1);
  const frameCount = options.playbackLike
    ? Math.min(LIVE_SMOOTHING_FRAME_COUNT, naturalCount)
    : Math.min(MAX_FRAMES, naturalCount);
  const positions = options.playbackLike
    ? Array.from(
      { length: frameCount },
      (_, index) => Math.max(startSample, endSample - FFT_SIZE - (frameCount - 1 - index) * FFT_HOP),
    )
    : Array.from({ length: frameCount }, (_, index) => {
      if (frameCount === 1) return startSample;
      if (naturalCount <= MAX_FRAMES) return startSample + index * FFT_HOP;
      return Math.round(startSample + (index / (frameCount - 1)) * (maxStart - startSample));
    });

  const channelCount = Math.min(2, buffer.numberOfChannels);
  const packedChannels = Array.from(
    { length: channelCount },
    () => new Float32Array(frameCount * FFT_SIZE),
  );

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const frameStart = positions[frameIndex];
    const copyEnd = Math.min(buffer.length, frameStart + FFT_SIZE, endSample);
    for (let channel = 0; channel < channelCount; channel += 1) {
      packedChannels[channel].set(
        buffer.getChannelData(channel).subarray(frameStart, copyEnd),
        frameIndex * FFT_SIZE,
      );
    }
    if (frameIndex > 0 && frameIndex % 24 === 0) await nextFrame();
  }

  const frameWeights = options.playbackLike
    ? Float32Array.from(
      { length: frameCount },
      (_, index) => (1 - LIVE_SMOOTHING_TIME_CONSTANT) * LIVE_SMOOTHING_TIME_CONSTANT ** (frameCount - 1 - index),
    )
    : undefined;

  return { channels: packedChannels, frameCount, frameWeights };
}

/**
 * Returns the backward-looking window needed to approximate an AnalyserNode
 * frame at a stopped playhead, including its short exponential history.
 */
export function playbackLikeSelection(playheadTime: number, duration: number, sampleRate: number): AudioSelection {
  const end = Math.max(0.1, Math.min(duration, playheadTime));
  const lookback = (FFT_SIZE + (LIVE_SMOOTHING_FRAME_COUNT - 1) * FFT_HOP) / sampleRate;
  return { start: Math.max(0, end - lookback), end };
}
