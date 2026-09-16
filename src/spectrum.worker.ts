/// <reference lib="webworker" />
import FFT from "fft.js";
import type { SpectrumWorkerRequest, SpectrumWorkerResponse } from "./spectrum";

const worker = self as unknown as DedicatedWorkerGlobalScope;

worker.onmessage = (event: MessageEvent<SpectrumWorkerRequest>) => {
  const { jobId, channels, sampleRate, fftSize, frameCount } = event.data;
  const fft = new FFT(fftSize);
  const input = new Float32Array(fftSize);
  const output = fft.createComplexArray();
  const power = new Float64Array(fftSize / 2 + 1);
  const window = new Float32Array(fftSize);

  for (let index = 0; index < fftSize; index += 1) {
    window[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / (fftSize - 1)));
  }

  for (const channel of channels) {
    for (let frame = 0; frame < frameCount; frame += 1) {
      const offset = frame * fftSize;
      for (let index = 0; index < fftSize; index += 1) {
        input[index] = channel[offset + index] * window[index];
      }
      fft.realTransform(output, input);
      for (let bin = 0; bin <= fftSize / 2; bin += 1) {
        const real = output[bin * 2];
        const imaginary = output[bin * 2 + 1];
        power[bin] += real * real + imaginary * imaginary;
      }
    }
  }

  let maximum = Number.EPSILON;
  for (const value of power) maximum = Math.max(maximum, value);
  const bins = new Float32Array(power.length);
  for (let index = 0; index < power.length; index += 1) {
    bins[index] = Math.max(-90, 10 * Math.log10(Math.max(Number.EPSILON, power[index]) / maximum));
  }

  const response: SpectrumWorkerResponse = { jobId, bins, sampleRate, fftSize };
  worker.postMessage(response, [bins.buffer]);
};

export {};

