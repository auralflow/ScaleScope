import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import WaveSurfer from "wavesurfer.js";
import Minimap from "wavesurfer.js/dist/plugins/minimap.esm.js";
import Regions from "wavesurfer.js/dist/plugins/regions.esm.js";
import Timeline from "wavesurfer.js/dist/plugins/timeline.esm.js";
import SpectrumWorker from "../spectrum.worker?worker&inline";
import type { PitchClass } from "../music";
import {
  FFT_SIZE,
  LIVE_SMOOTHING_TIME_CONSTANT,
  playbackLikeSelection,
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
  auditionEnabled: boolean;
  onAudition: (frequency: number) => void;
  onAuditionEnd: () => void;
}

type SpectrumSource = "file" | "microphone";

type LoopGesture = {
  pointerId: number;
  mode: "select" | "resize-start" | "resize-end";
  anchor: number;
  current: number;
  startClientX: number;
  moved: boolean;
};

type MinimapGesture = {
  pointerId: number;
  mode: "select" | "resize-start" | "resize-end";
  startPercent: number;
  startClientX: number;
  initialLeft: number;
  initialWidth: number;
  moved: boolean;
};

const POINTER_DRAG_THRESHOLD = 4;
const MIN_ZOOM_WINDOW_PERCENT = 2;
const MAX_WAVEFORM_ZOOM = 1200;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00.000";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(3).padStart(6, "0")}`;
}

export function AudioAnalyzer({ selected, previewed, onToggle, onDetected, auditionEnabled, onAudition, onAuditionEnd }: AudioAnalyzerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLDivElement>(null);
  const minimapWaveRef = useRef<HTMLDivElement>(null);
  const waveSurferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<ReturnType<typeof Regions.create> | null>(null);
  const regionRef = useRef<ReturnType<ReturnType<typeof Regions.create>["addRegion"]> | null>(null);
  const loopDragRef = useRef<LoopGesture | null>(null);
  const minimapGestureRef = useRef<MinimapGesture | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const microphoneContextRef = useRef<AudioContext | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const microphoneSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const microphoneAnalyserRef = useRef<AnalyserNode | null>(null);
  const microphoneSinkRef = useRef<GainNode | null>(null);
  const microphoneJobRef = useRef(0);
  const loopRef = useRef(false);
  const jobRef = useRef(0);
  const liveSpectrumRef = useRef<SpectrumResult | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [duration, setDuration] = useState(0);
  const [selection, setSelection] = useState<AudioSelection | null>(null);
  const [playheadTime, setPlayheadTime] = useState(0);
  const [decodedBuffer, setDecodedBuffer] = useState<AudioBuffer | null>(null);
  const [spectrum, setSpectrum] = useState<SpectrumResult | null>(null);
  const [pausedLiveSpectrum, setPausedLiveSpectrum] = useState<SpectrumResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [liveAnalyser, setLiveAnalyser] = useState<AnalyserNode | null>(null);
  const [microphoneAnalyser, setMicrophoneAnalyser] = useState<AnalyserNode | null>(null);
  const [microphoneStarting, setMicrophoneStarting] = useState(false);
  const [spectrumSource, setSpectrumSource] = useState<SpectrumSource>("file");
  const [loop, setLoop] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [minimapViewport, setMinimapViewport] = useState({ left: 0, width: 100 });
  const [audioVolume, setAudioVolume] = useState(100);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const rememberLiveSpectrum = useCallback((frame: SpectrumResult) => {
    liveSpectrumRef.current = frame;
  }, []);

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
    if (!file || !waveformRef.current || !timelineRef.current || !minimapWaveRef.current) return;
    const objectUrl = URL.createObjectURL(file);
    const regions = Regions.create();
    regionsRef.current = regions;
    const wavesurfer = WaveSurfer.create({
      container: waveformRef.current,
      url: objectUrl,
      height: 112,
      waveColor: "#4a4f59",
      progressColor: "#858b96",
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      cursorColor: "#6ee7a2",
      dragToSeek: false,
      interact: false,
      minPxPerSec: 0,
      plugins: [
        regions,
        Timeline.create({ container: timelineRef.current, height: 20, style: { color: "#8c929d", fontSize: "10px" } }),
        Minimap.create({
          container: minimapWaveRef.current,
          height: 42,
          waveColor: "#33373f",
          progressColor: "#666d78",
          cursorColor: "#6ee7a2",
          cursorWidth: 2,
          interact: false,
          dragToSeek: false,
          overlayColor: "transparent",
        }),
      ],
    });
    waveSurferRef.current = wavesurfer;

    const updateMinimapViewport = (visibleStartTime?: number, visibleEndTime?: number) => {
      const trackDuration = wavesurfer.getDuration();
      if (!trackDuration) return;
      if (typeof visibleStartTime === "number" && typeof visibleEndTime === "number") {
        setMinimapViewport({
          left: Math.max(0, Math.min(100, (visibleStartTime / trackDuration) * 100)),
          width: Math.max(0, Math.min(100, ((visibleEndTime - visibleStartTime) / trackDuration) * 100)),
        });
        return;
      }

      const wrapper = wavesurfer.getWrapper();
      const totalWidth = Math.max(wrapper.clientWidth, wrapper.scrollWidth);
      const viewportWidth = wavesurfer.getWidth();
      if (!totalWidth) return;
      setMinimapViewport({
        left: Math.max(0, Math.min(100, (wavesurfer.getScroll() / totalWidth) * 100)),
        width: Math.max(0, Math.min(100, (viewportWidth / totalWidth) * 100)),
      });
    };

    let audioContext: AudioContext | null = null;
    let mediaSource: MediaElementAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    try {
      audioContext = new AudioContext();
      mediaSource = audioContext.createMediaElementSource(wavesurfer.getMediaElement());
      analyser = audioContext.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = LIVE_SMOOTHING_TIME_CONSTANT;
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
    setPausedLiveSpectrum(null);
    liveSpectrumRef.current = null;
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
      wavesurfer.setVolume(audioVolume / 100);
      setDuration(trackDuration);
      setSelection({ start: 0, end: trackDuration });
      setDecodedBuffer(buffer);
      setLoading(false);
      requestAnimationFrame(() => updateMinimapViewport());
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
    const unsubscribePlay = wavesurfer.on("play", () => {
      setPausedLiveSpectrum(null);
      setPlaying(true);
    });
    const unsubscribePause = wavesurfer.on("pause", () => {
      setPlaying(false);
      setPlayheadTime(wavesurfer.getCurrentTime());
      if (!loopRef.current && liveSpectrumRef.current) {
        setPausedLiveSpectrum(liveSpectrumRef.current);
        setBusy(false);
      }
    });
    const unsubscribeFinish = wavesurfer.on("finish", () => {
      setPlaying(false);
      setPlayheadTime(wavesurfer.getDuration());
    });
    const unsubscribeInteraction = wavesurfer.on("interaction", (time) => setPlayheadTime(time));
    const unsubscribeScroll = wavesurfer.on("scroll", updateMinimapViewport);
    const unsubscribeZoom = wavesurfer.on("zoom", () => requestAnimationFrame(() => updateMinimapViewport()));
    const unsubscribeResize = wavesurfer.on("resize", () => requestAnimationFrame(() => updateMinimapViewport()));
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
      unsubscribeScroll();
      unsubscribeZoom();
      unsubscribeResize();
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
      : playbackLikeSelection(playheadTime, decodedBuffer.duration, decodedBuffer.sampleRate)
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

    void prepareSpectrumFrames(decodedBuffer, spectrumSelection, controller.signal, { playbackLike: !loop })
      .then(({ channels, frameCount, frameWeights }) => {
        if (controller.signal.aborted) return;
        worker.postMessage(
          { jobId, channels, sampleRate: decodedBuffer.sampleRate, fftSize: FFT_SIZE, frameCount, frameWeights },
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
  }, [decodedBuffer, loop, spectrumSelection?.start, spectrumSelection?.end]);

  const selectFileSource = () => {
    microphoneJobRef.current += 1;
    disposeMicrophoneResources();
    liveSpectrumRef.current = null;
    setPausedLiveSpectrum(null);
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
    onAuditionEnd();
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
      analyser.smoothingTimeConstant = LIVE_SMOOTHING_TIME_CONSTANT;
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

  const setPlaybackVolume = (value: number) => {
    const nextVolume = Math.max(0, Math.min(100, value));
    setAudioVolume(nextVolume);
    waveSurferRef.current?.setVolume(nextVolume / 100);
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

  const waveformTimeAt = (clientX: number): number | null => {
    const wavesurfer = waveSurferRef.current;
    const waveform = waveformRef.current;
    if (!wavesurfer || !waveform || !duration) return null;
    const wrapper = wavesurfer.getWrapper();
    const rect = waveform.getBoundingClientRect();
    const totalWidth = Math.max(wavesurfer.getWidth(), wrapper.scrollWidth);
    if (!rect.width || !totalWidth) return null;
    const x = clientX - rect.left + wavesurfer.getScroll();
    return Math.max(0, Math.min(duration, (x / totalWidth) * duration));
  };

  const drawLoopRange = (first: number, second: number): AudioSelection | null => {
    if (!duration) return null;
    let start = Math.max(0, Math.min(first, second));
    let end = Math.min(duration, Math.max(first, second));
    if (end - start < 0.1) {
      if (start + 0.1 <= duration) end = start + 0.1;
      else start = Math.max(0, end - 0.1);
    }

    const regions = regionsRef.current;
    if (!regions) return null;
    const range = { start, end };
    if (regionRef.current) regionRef.current.setOptions(range);
    else {
      regionRef.current = regions.addRegion({
        id: "analysis-range",
        ...range,
        minLength: 0.1,
        drag: true,
        resize: true,
        color: "rgba(255, 95, 80, 0.16)",
      });
    }
    return range;
  };

  const beginLoopRangeDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const time = waveformTimeAt(event.clientX);
    if (time === null) return;
    event.preventDefault();
    event.stopPropagation();

    if (!loop) {
      setPausedLiveSpectrum(null);
      waveSurferRef.current?.setTime(time);
      setPlayheadTime(time);
      return;
    }

    const wavesurfer = waveSurferRef.current;
    const wrapper = wavesurfer?.getWrapper();
    const totalWidth = wrapper && wavesurfer ? Math.max(wavesurfer.getWidth(), wrapper.scrollWidth) : 0;
    const boundaryThreshold = totalWidth ? (duration * 10) / totalWidth : 0;
    const nearStart = selection && Math.abs(time - selection.start) <= boundaryThreshold;
    const nearEnd = selection && Math.abs(time - selection.end) <= boundaryThreshold;
    const mode = nearStart ? "resize-start" : nearEnd ? "resize-end" : "select";
    const anchor = mode === "resize-start"
      ? selection?.end ?? time
      : mode === "resize-end"
        ? selection?.start ?? time
        : time;
    loopDragRef.current = {
      pointerId: event.pointerId,
      mode,
      anchor,
      current: time,
      startClientX: event.clientX,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveLoopRangeDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = loopDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const end = waveformTimeAt(event.clientX);
    if (end === null) return;
    event.preventDefault();
    event.stopPropagation();
    drag.current = end;
    if (!drag.moved && Math.abs(event.clientX - drag.startClientX) >= POINTER_DRAG_THRESHOLD) drag.moved = true;
    if (drag.moved) drawLoopRange(drag.anchor, drag.current);
  };

  const finishLoopRangeDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = loopDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const end = waveformTimeAt(event.clientX) ?? drag.current;
    event.preventDefault();
    event.stopPropagation();
    if (drag.moved) {
      const range = drawLoopRange(drag.anchor, end);
      if (range) setSelection(range);
    } else {
      if (!loopRef.current) setPausedLiveSpectrum(null);
      waveSurferRef.current?.setTime(end);
      setPlayheadTime(end);
    }
    loopDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const cancelLoopRangeDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (loopDragRef.current?.pointerId !== event.pointerId) return;
    loopDragRef.current = null;
  };

  const setMinimapWindow = (left: number, width: number) => {
    const wavesurfer = waveSurferRef.current;
    if (!wavesurfer || !duration) return;
    const nextWidth = Math.max(MIN_ZOOM_WINDOW_PERCENT, Math.min(100, width));
    const nextLeft = Math.max(0, Math.min(100 - nextWidth, left));
    const viewportWidth = wavesurfer.getWidth();
    const nextZoom = nextWidth >= 99.5 || !viewportWidth
      ? 0
      : Math.max(1, Math.min(MAX_WAVEFORM_ZOOM, viewportWidth / (duration * (nextWidth / 100))));
    setMinimapViewport({ left: nextLeft, width: nextWidth });
    setZoom(nextZoom);
    wavesurfer.zoom(nextZoom);
    requestAnimationFrame(() => wavesurfer.setScrollTime((nextLeft / 100) * duration));
  };

  const minimapPercentAt = (clientX: number) => {
    const minimap = minimapRef.current;
    if (!minimap) return null;
    const rect = minimap.getBoundingClientRect();
    if (!rect.width) return null;
    return Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
  };

  const beginMinimapSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const startPercent = minimapPercentAt(event.clientX);
    if (startPercent === null) return;
    event.preventDefault();
    event.stopPropagation();
    minimapGestureRef.current = {
      pointerId: event.pointerId,
      mode: "select",
      startPercent,
      startClientX: event.clientX,
      initialLeft: minimapViewport.left,
      initialWidth: minimapViewport.width,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const beginMinimapResize = (event: ReactPointerEvent<HTMLButtonElement>, edge: "start" | "end") => {
    if (event.button !== 0) return;
    const startPercent = minimapPercentAt(event.clientX);
    if (startPercent === null) return;
    event.preventDefault();
    event.stopPropagation();
    minimapGestureRef.current = {
      pointerId: event.pointerId,
      mode: edge === "start" ? "resize-start" : "resize-end",
      startPercent,
      startClientX: event.clientX,
      initialLeft: minimapViewport.left,
      initialWidth: minimapViewport.width,
      moved: false,
    };
    minimapRef.current?.setPointerCapture(event.pointerId);
  };

  const moveMinimapGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = minimapGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const currentPercent = minimapPercentAt(event.clientX);
    if (currentPercent === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (!gesture.moved && Math.abs(event.clientX - gesture.startClientX) >= POINTER_DRAG_THRESHOLD) gesture.moved = true;
    if (!gesture.moved) return;

    if (gesture.mode === "select") {
      setMinimapWindow(Math.min(gesture.startPercent, currentPercent), Math.abs(currentPercent - gesture.startPercent));
      return;
    }

    const initialRight = gesture.initialLeft + gesture.initialWidth;
    const offset = currentPercent - gesture.startPercent;
    if (gesture.mode === "resize-start") {
      const left = Math.max(0, Math.min(initialRight - MIN_ZOOM_WINDOW_PERCENT, gesture.initialLeft + offset));
      setMinimapWindow(left, initialRight - left);
    } else {
      const right = Math.min(100, Math.max(gesture.initialLeft + MIN_ZOOM_WINDOW_PERCENT, initialRight + offset));
      setMinimapWindow(gesture.initialLeft, right - gesture.initialLeft);
    }
  };

  const finishMinimapGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = minimapGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (gesture.mode === "select" && !gesture.moved) {
      const percent = minimapPercentAt(event.clientX) ?? gesture.startPercent;
      const time = (percent / 100) * duration;
      if (!loopRef.current) setPausedLiveSpectrum(null);
      waveSurferRef.current?.setTime(time);
      setPlayheadTime(time);
    }
    minimapGestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const toggleLoopMode = () => {
    const nextLoop = !loop;
    loopRef.current = nextLoop;
    setLoop(nextLoop);
    setPausedLiveSpectrum(null);

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

  const deleteAudio = () => {
    waveSurferRef.current?.pause();
    onAuditionEnd();
    jobRef.current += 1;
    loopRef.current = false;
    setFile(null);
    setDragging(false);
    setDuration(0);
    setSelection(null);
    setPlayheadTime(0);
    setDecodedBuffer(null);
    setSpectrum(null);
    setPausedLiveSpectrum(null);
    liveSpectrumRef.current = null;
    setBusy(false);
    setLoading(false);
    setPlaying(false);
    setLoop(false);
    setZoom(0);
    setAudioVolume(100);
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
            <label className="audio-volume-control">
              <span>Audio</span>
              <input
                type="range"
                min="0"
                max="100"
                value={audioVolume}
                disabled={!file}
                aria-label="Audio playback volume"
                title={`Audio playback volume: ${audioVolume}%`}
                onChange={(event) => setPlaybackVolume(Number(event.target.value))}
              />
              <output>{audioVolume}%</output>
            </label>
            <label className="zoom-control">
              <span>Zoom</span>
              <input
                type="range"
                min="0"
                max={MAX_WAVEFORM_ZOOM}
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
        <div
          className={`waveform-frame ${loop ? "is-loop-range-selecting" : ""}`}
          onPointerDownCapture={beginLoopRangeDrag}
          onPointerMoveCapture={moveLoopRangeDrag}
          onPointerUpCapture={finishLoopRangeDrag}
          onPointerCancelCapture={cancelLoopRangeDrag}
        >
          {loading && <div className="waveform-loading">Decoding audio…</div>}
          <div ref={waveformRef} className="waveform" />
          <div ref={timelineRef} className="waveform-timeline" />
        </div>
        <div
          ref={minimapRef}
          className="waveform-minimap"
          onPointerDown={beginMinimapSelection}
          onPointerMove={moveMinimapGesture}
          onPointerUp={finishMinimapGesture}
          onPointerCancel={finishMinimapGesture}
        >
          <div ref={minimapWaveRef} className="waveform-minimap__wave" />
          {duration > 0 && (
            <div
              className="minimap-zoom-window"
              style={{ left: `${minimapViewport.left}%`, width: `${minimapViewport.width}%` }}
              aria-label="Visible waveform window"
            >
              <button
                type="button"
                className="minimap-zoom-handle minimap-zoom-handle--start"
                aria-label="Resize zoom window from the start"
                onPointerDown={(event) => beginMinimapResize(event, "start")}
              />
              <button
                type="button"
                className="minimap-zoom-handle minimap-zoom-handle--end"
                aria-label="Resize zoom window from the end"
                onPointerDown={(event) => beginMinimapResize(event, "end")}
              />
            </div>
          )}
        </div>
      </div>

      <SpectrumView
        spectrum={!loop && pausedLiveSpectrum ? pausedLiveSpectrum : spectrum}
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
        auditionEnabled={auditionEnabled}
        onAudition={onAudition}
        onAuditionEnd={onAuditionEnd}
        onDetected={onDetected}
        onLiveSpectrumFrame={rememberLiveSpectrum}
      />
    </section>
  );
}
