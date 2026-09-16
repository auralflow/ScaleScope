import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import Minimap from "wavesurfer.js/dist/plugins/minimap.esm.js";
import Regions from "wavesurfer.js/dist/plugins/regions.esm.js";
import Timeline from "wavesurfer.js/dist/plugins/timeline.esm.js";
import SpectrumWorker from "../spectrum.worker?worker&inline";
import type { PitchClass } from "../music";
import {
  FFT_SIZE,
  prepareSpectrumFrames,
  type AudioSelection,
  type SpectrumResult,
  type SpectrumWorkerResponse,
} from "../spectrum";
import { SpectrumView } from "./SpectrumView";

interface AudioAnalyzerProps {
  selected: ReadonlySet<PitchClass>;
  previewed: ReadonlySet<PitchClass>;
  onToggle: (note: PitchClass) => void;
  onDetected: (notes: readonly PitchClass[]) => void;
}

type SpectrumSource = "file" | "microphone";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00.000";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(3).padStart(6, "0")}`;
}

export function AudioAnalyzer({ selected, previewed, onToggle, onDetected }: AudioAnalyzerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLDivElement>(null);
  const waveSurferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<ReturnType<typeof Regions.create> | null>(null);
  const regionRef = useRef<ReturnType<ReturnType<typeof Regions.create>["addRegion"]> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const microphoneContextRef = useRef<AudioContext | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const microphoneSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const microphoneAnalyserRef = useRef<AnalyserNode | null>(null);
  const microphoneSinkRef = useRef<GainNode | null>(null);
  const microphoneJobRef = useRef(0);
  const auditionContextRef = useRef<AudioContext | null>(null);
  const auditionOscillatorRef = useRef<OscillatorNode | null>(null);
  const auditionGainRef = useRef<GainNode | null>(null);
  const auditionVolumeRef = useRef(0.2);
  const loopRef = useRef(false);
  const jobRef = useRef(0);

  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [duration, setDuration] = useState(0);
  const [selection, setSelection] = useState<AudioSelection | null>(null);
  const [playheadTime, setPlayheadTime] = useState(0);
  const [decodedBuffer, setDecodedBuffer] = useState<AudioBuffer | null>(null);
  const [spectrum, setSpectrum] = useState<SpectrumResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [liveAnalyser, setLiveAnalyser] = useState<AnalyserNode | null>(null);
  const [microphoneAnalyser, setMicrophoneAnalyser] = useState<AnalyserNode | null>(null);
  const [microphoneStarting, setMicrophoneStarting] = useState(false);
  const [spectrumSource, setSpectrumSource] = useState<SpectrumSource>("file");
  const [loop, setLoop] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [auditionVolume, setAuditionVolume] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const disposeMicrophoneResources = () => {
    microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
    microphoneSourceRef.current?.disconnect();
    microphoneAnalyserRef.current?.disconnect();
    microphoneSinkRef.current?.disconnect();
    void microphoneContextRef.current?.close();
    microphoneStreamRef.current = null;
    microphoneSourceRef.current = null;
    microphoneAnalyserRef.current = null;
    microphoneSinkRef.current = null;
    microphoneContextRef.current = null;
  };

  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);

  useEffect(() => {
    if (!file || !waveformRef.current || !timelineRef.current || !minimapRef.current) return;
    const objectUrl = URL.createObjectURL(file);
    const regions = Regions.create();
    regionsRef.current = regions;
    const wavesurfer = WaveSurfer.create({
      container: waveformRef.current,
      url: objectUrl,
      height: 112,
      waveColor: "#4a4f59",
      progressColor: "#858b96",
      cursorColor: "#ff5f50",
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      dragToSeek: true,
      minPxPerSec: 0,
      plugins: [
        regions,
        Timeline.create({ container: timelineRef.current, height: 20, style: { color: "#8c929d", fontSize: "10px" } }),
        Minimap.create({
          container: minimapRef.current,
          height: 42,
          waveColor: "#33373f",
          progressColor: "#666d78",
          overlayColor: "rgba(255, 95, 80, 0.12)",
        }),
      ],
    });
    waveSurferRef.current = wavesurfer;

    let audioContext: AudioContext | null = null;
    let mediaSource: MediaElementAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    try {
      audioContext = new AudioContext();
      mediaSource = audioContext.createMediaElementSource(wavesurfer.getMediaElement());
      analyser = audioContext.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0.68;
      analyser.minDecibels = -100;
      analyser.maxDecibels = -10;
      mediaSource.connect(analyser);
      analyser.connect(audioContext.destination);
      audioContextRef.current = audioContext;
      setLiveAnalyser(analyser);
    } catch {
      // Static selection analysis still works if real-time Web Audio is unavailable.
      void audioContext?.close();
      audioContext = null;
      setLiveAnalyser(null);
    }
    setLoading(true);
    setError(null);
    setWarning(null);
    setSpectrum(null);
    setDecodedBuffer(null);
    setSelection(null);
    setDuration(0);

    const unsubscribeReady = wavesurfer.on("ready", () => {
      const trackDuration = wavesurfer.getDuration();
      const buffer = wavesurfer.getDecodedData();
      if (!buffer) {
        setError("The browser can play this file but did not provide data for spectrum analysis.");
        setLoading(false);
        return;
      }
      setDuration(trackDuration);
      setSelection({ start: 0, end: trackDuration });
      setDecodedBuffer(buffer);
      setLoading(false);
      if (loopRef.current) {
        regionRef.current = regions.addRegion({
          id: "analysis-range",
          start: 0,
          end: trackDuration,
          minLength: 0.1,
          drag: true,
          resize: true,
          color: "rgba(255, 95, 80, 0.16)",
        });
      }
      if (trackDuration > 600) {
        setWarning("This file is longer than 10 minutes. Analysis is available but may use more memory and take longer.");
      }
    });
    const unsubscribeError = wavesurfer.on("error", () => {
      setError("Could not decode this audio. Try WAV, MP3, M4A/AAC, or FLAC in another browser.");
      setLoading(false);
    });
    const unsubscribePlay = wavesurfer.on("play", () => setPlaying(true));
    const unsubscribePause = wavesurfer.on("pause", () => {
      setPlaying(false);
      setPlayheadTime(wavesurfer.getCurrentTime());
    });
    const unsubscribeFinish = wavesurfer.on("finish", () => {
      setPlaying(false);
      setPlayheadTime(wavesurfer.getDuration());
    });
    const unsubscribeInteraction = wavesurfer.on("interaction", (time) => setPlayheadTime(time));
    const unsubscribeRegion = regions.on("region-updated", (region) => {
      setSelection({ start: region.start, end: Math.max(region.start + 0.1, region.end) });
    });
    const unsubscribeRegionOut = regions.on("region-out", (region) => {
      if (region.id !== "analysis-range") return;
      if (loopRef.current && region) region.play();
    });

    return () => {
      unsubscribeReady();
      unsubscribeError();
      unsubscribePlay();
      unsubscribePause();
      unsubscribeFinish();
      unsubscribeInteraction();
      unsubscribeRegion();
      unsubscribeRegionOut();
      waveSurferRef.current = null;
      regionsRef.current = null;
      regionRef.current = null;
      setLiveAnalyser(null);
      mediaSource?.disconnect();
      analyser?.disconnect();
      if (audioContextRef.current === audioContext) audioContextRef.current = null;
      void audioContext?.close();
      wavesurfer.destroy();
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  useEffect(() => () => {
    auditionOscillatorRef.current?.stop();
    auditionOscillatorRef.current = null;
    void auditionContextRef.current?.close();
    auditionContextRef.current = null;
    microphoneJobRef.current += 1;
    microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
    microphoneSourceRef.current?.disconnect();
    microphoneAnalyserRef.current?.disconnect();
    microphoneSinkRef.current?.disconnect();
    void microphoneContextRef.current?.close();
  }, []);

  const spectrumSelection = decodedBuffer && selection
    ? loop
      ? selection
      : {
          start: Math.max(0, Math.min(decodedBuffer.duration - 0.1, playheadTime - 0.5)),
          end: Math.min(decodedBuffer.duration, Math.max(0.1, playheadTime + 0.5)),
        }
    : null;

  useEffect(() => {
    if (!decodedBuffer || !spectrumSelection) return;
    const controller = new AbortController();
    const worker = new SpectrumWorker();
    const jobId = ++jobRef.current;
    setBusy(true);
    setError(null);

    worker.onmessage = (event: MessageEvent<SpectrumWorkerResponse>) => {
      if (event.data.jobId !== jobRef.current) return;
      setSpectrum(event.data);
      setBusy(false);
      worker.terminate();
    };
    worker.onerror = () => {
      if (jobId === jobRef.current) {
        setError("Could not calculate the spectrum for this selection.");
        setBusy(false);
      }
      worker.terminate();
    };

    void prepareSpectrumFrames(decodedBuffer, spectrumSelection, controller.signal)
      .then(({ channels, frameCount }) => {
        if (controller.signal.aborted) return;
        worker.postMessage(
          { jobId, channels, sampleRate: decodedBuffer.sampleRate, fftSize: FFT_SIZE, frameCount },
          channels.map((channel) => channel.buffer),
        );
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        if (jobId === jobRef.current) {
          setError("Could not prepare this selection for spectrum analysis.");
          setBusy(false);
        }
      });

    return () => {
      controller.abort();
      worker.terminate();
    };
  }, [decodedBuffer, spectrumSelection?.start, spectrumSelection?.end]);

  const selectFileSource = () => {
    microphoneJobRef.current += 1;
    disposeMicrophoneResources();
    setMicrophoneAnalyser(null);
    setMicrophoneStarting(false);
    setSpectrumSource("file");
  };

  const selectMicrophoneSource = async () => {
    if (microphoneAnalyser) {
      setSpectrumSource("microphone");
      return;
    }

    const requestId = ++microphoneJobRef.current;
    waveSurferRef.current?.pause();
    stopAudition();
    setSpectrumSource("microphone");
    setMicrophoneStarting(true);
    setError(null);
    setWarning(null);

    let context: AudioContext | null = null;
    let stream: MediaStream | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let sink: GainNode | null = null;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new DOMException("Microphone capture is unavailable in this browser.", "NotSupportedError");
      }
      context = new AudioContext();
      if (context.state === "suspended") await context.resume();
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
        video: false,
      });
      if (requestId !== microphoneJobRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        await context.close();
        return;
      }

      source = context.createMediaStreamSource(stream);
      analyser = context.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0.68;
      analyser.minDecibels = -100;
      analyser.maxDecibels = -10;
      sink = context.createGain();
      sink.gain.value = 0;
      source.connect(analyser);
      analyser.connect(sink).connect(context.destination);

      microphoneContextRef.current = context;
      microphoneStreamRef.current = stream;
      microphoneSourceRef.current = source;
      microphoneAnalyserRef.current = analyser;
      microphoneSinkRef.current = sink;
      stream.getAudioTracks()[0]?.addEventListener("ended", () => {
        if (requestId !== microphoneJobRef.current) return;
        microphoneJobRef.current += 1;
        disposeMicrophoneResources();
        setMicrophoneAnalyser(null);
        setMicrophoneStarting(false);
        setSpectrumSource("file");
        setError("Microphone input stopped. Select Microphone to start it again.");
      }, { once: true });
      setMicrophoneAnalyser(analyser);
      setMicrophoneStarting(false);
    } catch (caught: unknown) {
      source?.disconnect();
      analyser?.disconnect();
      sink?.disconnect();
      stream?.getTracks().forEach((track) => track.stop());
      void context?.close();
      if (requestId !== microphoneJobRef.current) return;
      const name = caught instanceof DOMException ? caught.name : "";
      const message = name === "NotAllowedError" || name === "SecurityError"
        ? "Microphone access was denied. Allow microphone access in the browser settings and try again."
        : name === "NotFoundError"
          ? "No microphone was found on this device."
          : "Could not start the microphone. Check the browser microphone permission and input device.";
      setMicrophoneAnalyser(null);
      setMicrophoneStarting(false);
      setSpectrumSource("file");
      setError(message);
    }
  };

  const chooseFile = (nextFile: File | undefined) => {
    if (!nextFile) return;
    selectFileSource();
    setFile(nextFile);
    setBusy(false);
    setError(null);
    setWarning(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const togglePlayback = async () => {
    if (spectrumSource !== "file") return;
    const wavesurfer = waveSurferRef.current;
    const region = regionRef.current;
    if (!wavesurfer || (loopRef.current && !region)) return;
    if (wavesurfer.isPlaying()) wavesurfer.pause();
    else {
      if (audioContextRef.current?.state === "suspended") await audioContextRef.current.resume();
      if (loopRef.current && region) region.play();
      else wavesurfer.play();
    }
  };

  useEffect(() => {
    const handleSpace = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("button, input, select, textarea, [contenteditable='true'], [role='button']")) return;
      event.preventDefault();
      void togglePlayback();
    };

    window.addEventListener("keydown", handleSpace);
    return () => window.removeEventListener("keydown", handleSpace);
  }, [spectrumSource]);

  const selectWholeFile = () => {
    if (!duration) return;
    regionRef.current?.setOptions({ start: 0, end: duration });
    setSelection({ start: 0, end: duration });
  };

  const toggleLoopMode = () => {
    const nextLoop = !loop;
    loopRef.current = nextLoop;
    setLoop(nextLoop);

    if (nextLoop) {
      const regions = regionsRef.current;
      const range = selection;
      if (regions && range && !regionRef.current) {
        regionRef.current = regions.addRegion({
          id: "analysis-range",
          start: range.start,
          end: range.end,
          minLength: 0.1,
          drag: true,
          resize: true,
          color: "rgba(255, 95, 80, 0.16)",
        });
      }
      if (waveSurferRef.current?.isPlaying()) regionRef.current?.play();
    } else {
      regionRef.current?.remove();
      regionRef.current = null;
    }
  };

  const setToneVolume = (value: number) => {
    setAuditionVolume(value);
    auditionVolumeRef.current = value / 100;
    const context = auditionContextRef.current;
    const gain = auditionGainRef.current;
    if (context && gain) gain.gain.setTargetAtTime(value / 100, context.currentTime, 0.01);
  };

  const auditionNote = (frequency: number) => {
    let context = auditionContextRef.current;
    if (!context || context.state === "closed") {
      context = new AudioContext();
      auditionContextRef.current = context;
    }
    if (context.state === "suspended") void context.resume();

    let oscillator = auditionOscillatorRef.current;
    if (!oscillator) {
      oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, auditionVolumeRef.current), context.currentTime + 0.012);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      auditionOscillatorRef.current = oscillator;
      auditionGainRef.current = gain;
    }
    oscillator.frequency.setTargetAtTime(frequency, context.currentTime, 0.008);
  };

  const stopAudition = () => {
    const context = auditionContextRef.current;
    const oscillator = auditionOscillatorRef.current;
    const gain = auditionGainRef.current;
    if (!context || !oscillator || !gain) return;
    gain.gain.cancelScheduledValues(context.currentTime);
    gain.gain.setTargetAtTime(0.0001, context.currentTime, 0.008);
    oscillator.stop(context.currentTime + 0.045);
    auditionOscillatorRef.current = null;
    auditionGainRef.current = null;
  };

  const deleteAudio = () => {
    waveSurferRef.current?.pause();
    stopAudition();
    jobRef.current += 1;
    loopRef.current = false;
    setFile(null);
    setDragging(false);
    setDuration(0);
    setSelection(null);
    setPlayheadTime(0);
    setDecodedBuffer(null);
    setSpectrum(null);
    setBusy(false);
    setLoading(false);
    setPlaying(false);
    setLoop(false);
    setZoom(0);
    setError(null);
    setWarning(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <section className="audio-section" aria-labelledby="audio-title">
      <div className="section-heading section-heading--audio">
        <div>
          <span className="eyebrow">02 · Audio analysis</span>
          <h2 id="audio-title">Spectrum analyzer</h2>
        </div>
        <div className="privacy-note"><span /> Processed only on this device</div>
      </div>

      <input
        ref={fileInputRef}
        className="audio-file-input"
        type="file"
        accept="audio/*,.wav,.mp3,.m4a,.aac,.flac"
        onChange={(event) => chooseFile(event.target.files?.[0])}
      />

      {error && <div className="message message--error">{error}</div>}
      {warning && <div className="message message--warning">{warning}</div>}

      <div className={`wave-workspace ${file && spectrumSource === "file" ? "is-visible" : ""} ${loop ? "is-looping" : ""}`}>
        <div className="audio-toolbar">
          <div className="transport-controls">
            <button
              type="button"
              className="round-button"
              onClick={togglePlayback}
              disabled={!selection || loading}
              aria-label={playing ? "Pause" : loop ? "Play loop" : "Play"}
              title="Play / Pause · Space"
            >
              {playing ? "Ⅱ" : "▶"}
            </button>
            <button
              type="button"
              className={`loop-button ${loop ? "is-active" : ""}`}
              onClick={toggleLoopMode}
              disabled={!selection}
            >
              ↻ Loop
            </button>
            <button type="button" className="text-button" onClick={selectWholeFile} disabled={!selection || !loop}>Whole file</button>
            <button type="button" className="text-button" onClick={() => fileInputRef.current?.click()}>Replace audio</button>
            <button type="button" className="text-button delete-audio-button" onClick={deleteAudio}>Delete audio</button>
          </div>
          <div className="selection-readout">
            <span>Loop range</span>
            <strong>{loop && selection ? `${formatTime(selection.start)} — ${formatTime(selection.end)}` : "Loop is off"}</strong>
            <small>{loop && selection ? `${(selection.end - selection.start).toFixed(2)} sec` : ""}</small>
          </div>
          <div className="toolbar-sliders">
            <label className="zoom-control">
              <span>Zoom</span>
              <input
                type="range"
                min="0"
                max="180"
                value={zoom}
                disabled={!selection}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setZoom(value);
                  waveSurferRef.current?.zoom(value);
                }}
              />
            </label>
          </div>
        </div>
        <div className="waveform-frame">
          {loading && <div className="waveform-loading">Decoding audio…</div>}
          <div ref={waveformRef} className="waveform" />
          <div ref={timelineRef} className="waveform-timeline" />
        </div>
        <div ref={minimapRef} className="waveform-minimap" />
      </div>

      <SpectrumView
        spectrum={spectrum}
        analyser={spectrumSource === "microphone" ? microphoneAnalyser : liveAnalyser}
        live={spectrumSource === "microphone" ? Boolean(microphoneAnalyser) : playing}
        sourceMode={spectrumSource}
        microphoneState={microphoneStarting ? "starting" : microphoneAnalyser ? "active" : "idle"}
        onSelectFileSource={selectFileSource}
        onSelectMicrophoneSource={() => void selectMicrophoneSource()}
        selected={selected}
        previewed={previewed}
        onToggle={onToggle}
        busy={spectrumSource === "file" && busy}
        hasFile={Boolean(file)}
        dragging={dragging}
        onDraggingChange={setDragging}
        onFileDrop={chooseFile}
        onChooseFile={() => fileInputRef.current?.click()}
        onAudition={auditionNote}
        onAuditionEnd={stopAudition}
        auditionVolume={auditionVolume}
        onAuditionVolumeChange={setToneVolume}
        onDetected={onDetected}
      />
    </section>
  );
}
