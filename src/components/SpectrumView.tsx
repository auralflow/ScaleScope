import { useEffect, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  MAX_FREQUENCY,
  MAX_MIDI,
  MIN_FREQUENCY,
  MIN_MIDI,
  frequencyToUnit,
  midiToFrequency,
  noteAtFrequency,
  unitToFrequency,
} from "../audio-math";
import { NOTE_NAMES, asPitchClass, type PitchClass } from "../music";
import { analyzeSpectrumNotes, type DetectionAnalysis } from "../note-detection";
import {
  PINK_TILT_DB_PER_OCTAVE,
  writeTiltCompensatedBins,
  type SpectrumResult,
} from "../spectrum";

interface SpectrumViewProps {
  spectrum: SpectrumResult | null;
  analyser: AnalyserNode | null;
  live: boolean;
  sourceMode: "file" | "microphone";
  microphoneState: "idle" | "starting" | "active";
  onSelectFileSource: () => void;
  onSelectMicrophoneSource: () => void;
  selected: ReadonlySet<PitchClass>;
  previewed: ReadonlySet<PitchClass>;
  onToggle: (note: PitchClass) => void;
  busy: boolean;
  hasFile: boolean;
  dragging: boolean;
  onDraggingChange: (dragging: boolean) => void;
  onFileDrop: (file: File | undefined) => void;
  onChooseFile: () => void;
  auditionEnabled: boolean;
  onAudition: (frequency: number) => void;
  onAuditionEnd: () => void;
  onDetected: (notes: readonly PitchClass[]) => void;
}

interface HoverInfo {
  unit: number;
  db: number;
  frequency: number;
  midi: number;
  pitchClass: PitchClass;
  cents: number;
  lowerUnit: number;
  upperUnit: number;
}

const MIDIS = Array.from({ length: MAX_MIDI - MIN_MIDI + 1 }, (_, index) => MIN_MIDI + index);
const BLACK_CLASSES = new Set([1, 3, 6, 8, 10]);
const PANEL_DRAG_TYPE = "application/x-scale-scope-panel";

function isPanelDrag(event: DragEvent<HTMLElement>): boolean {
  return [...event.dataTransfer.types].includes(PANEL_DRAG_TYPE);
}

function amplitudeAt(spectrum: SpectrumResult | null, frequency: number): number {
  if (!spectrum) return -90;
  if (frequency > spectrum.sampleRate / 2) return -90;
  const exactBin = (frequency * spectrum.fftSize) / spectrum.sampleRate;
  const lower = Math.max(0, Math.min(spectrum.bins.length - 1, Math.floor(exactBin)));
  const upper = Math.min(spectrum.bins.length - 1, lower + 1);
  const mix = exactBin - lower;
  return spectrum.bins[lower] * (1 - mix) + spectrum.bins[upper] * mix;
}

function hoverFromUnit(unit: number, spectrum: SpectrumResult | null): HoverInfo {
  const frequency = unitToFrequency(Math.max(0, Math.min(1, unit)));
  const note = noteAtFrequency(frequency);
  return {
    unit,
    db: amplitudeAt(spectrum, frequency),
    frequency,
    midi: note.midi,
    pitchClass: note.pitchClass,
    cents: note.cents,
    lowerUnit: Math.max(0, frequencyToUnit(note.lowerFrequency)),
    upperUnit: Math.min(1, frequencyToUnit(note.upperFrequency)),
  };
}

export function SpectrumView({
  spectrum,
  analyser,
  live,
  sourceMode,
  microphoneState,
  onSelectFileSource,
  onSelectMicrophoneSource,
  selected,
  previewed,
  onToggle,
  busy,
  hasFile,
  dragging,
  onDraggingChange,
  onFileDrop,
  onChooseFile,
  auditionEnabled,
  onAudition,
  onAuditionEnd,
  onDetected,
}: SpectrumViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeSpectrumRef = useRef<SpectrumResult | null>(spectrum);
  const detectionAnalysisRef = useRef<DetectionAnalysis>({ pitchClasses: [], peaks: [] });
  const detectorReadoutRef = useRef<HTMLSpanElement>(null);
  const auditioningRef = useRef(false);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [pinkTiltEnabled, setPinkTiltEnabled] = useState(true);
  const [detectionSensitivity, setDetectionSensitivity] = useState(55);
  const [detectMessage, setDetectMessage] = useState("Detect notes from the current spectrum");

  useEffect(() => {
    setDetectMessage("Detect notes from the current spectrum");
  }, [spectrum?.jobId, sourceMode, pinkTiltEnabled, detectionSensitivity]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let animationFrame = 0;
    let lastFrameTime = 0;
    let processedBins = new Float32Array(0);
    let processedSpectrum: SpectrumResult | null = null;
    const liveBins = analyser ? new Float32Array(analyser.frequencyBinCount) : null;
    const liveSpectrum: SpectrumResult | null = analyser && liveBins ? {
      bins: liveBins,
      sampleRate: analyser.context.sampleRate,
      fftSize: analyser.fftSize,
      jobId: -1,
    } : null;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    };

    const prepareSpectrum = (source: SpectrumResult | null): SpectrumResult | null => {
      if (!source) return null;
      if (processedBins.length !== source.bins.length) {
        processedBins = new Float32Array(source.bins.length);
        processedSpectrum = {
          bins: processedBins,
          sampleRate: source.sampleRate,
          fftSize: source.fftSize,
          jobId: source.jobId,
        };
      }
      if (!processedSpectrum) return null;
      processedSpectrum.sampleRate = source.sampleRate;
      processedSpectrum.fftSize = source.fftSize;
      processedSpectrum.jobId = source.jobId;
      writeTiltCompensatedBins(
        source,
        processedBins,
        pinkTiltEnabled ? PINK_TILT_DB_PER_OCTAVE : 0,
      );
      return processedSpectrum;
    };

    const draw = (sourceSpectrum: SpectrumResult | null) => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const width = rect.width;
      const height = rect.height;
      const displaySpectrum = prepareSpectrum(sourceSpectrum);
      const analysis = analyzeSpectrumNotes(displaySpectrum, {
        sensitivity: detectionSensitivity,
        maxNotes: 12,
      });
      activeSpectrumRef.current = displaySpectrum;
      detectionAnalysisRef.current = analysis;
      if (detectorReadoutRef.current) {
        detectorReadoutRef.current.textContent = analysis.pitchClasses.length
          ? `${analysis.pitchClasses.length} pitch ${analysis.pitchClasses.length === 1 ? "class" : "classes"} · ${analysis.peaks.length} ${analysis.peaks.length === 1 ? "peak" : "peaks"}`
          : "No detector candidates";
      }

      const gradient = context.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, "rgba(255, 91, 74, 0.34)");
      gradient.addColorStop(1, "rgba(255, 91, 74, 0.015)");
      context.fillStyle = "#101216";
      context.fillRect(0, 0, width, height);

      context.strokeStyle = "rgba(255,255,255,0.06)";
      context.lineWidth = 1;
      for (let db = -90; db <= 0; db += 15) {
        const y = ((0 - db) / 90) * height;
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y);
        context.stroke();
      }
      for (let midi = 24; midi <= 108; midi += 12) {
        const x = frequencyToUnit(midiToFrequency(midi)) * width;
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
      }

      if (!displaySpectrum) return;
      const points = Math.max(320, Math.floor(width));
      context.beginPath();
      for (let index = 0; index <= points; index += 1) {
        const x = (index / points) * width;
        const frequency = unitToFrequency(index / points);
        const db = amplitudeAt(displaySpectrum, frequency);
        const y = Math.max(0, Math.min(height, (-db / 90) * height));
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.lineTo(width, height);
      context.lineTo(0, height);
      context.closePath();
      context.fillStyle = gradient;
      context.fill();

      for (const peak of analysis.peaks) {
        const x = frequencyToUnit(peak.frequency) * width;
        const noteHalfWidth = Math.max(
          3,
          (frequencyToUnit(midiToFrequency(peak.midi + 0.5)) - frequencyToUnit(midiToFrequency(peak.midi - 0.5))) * width * 0.34,
        );
        const opacity = 0.12 + Math.min(1, peak.strength) * 0.24;
        const peakGradient = context.createLinearGradient(x - noteHalfWidth, 0, x + noteHalfWidth, 0);
        peakGradient.addColorStop(0, "rgba(255, 255, 255, 0)");
        peakGradient.addColorStop(0.5, `rgba(255, 255, 255, ${opacity})`);
        peakGradient.addColorStop(1, "rgba(255, 255, 255, 0)");
        context.fillStyle = peakGradient;
        context.fillRect(x - noteHalfWidth, 0, noteHalfWidth * 2, height);
        context.fillStyle = `rgba(255, 255, 255, ${Math.min(0.68, opacity + 0.18)})`;
        context.fillRect(Math.round(x), 0, 1, height);
      }

      context.beginPath();
      for (let index = 0; index <= points; index += 1) {
        const x = (index / points) * width;
        const db = amplitudeAt(displaySpectrum, unitToFrequency(index / points));
        const y = Math.max(0, Math.min(height, (-db / 90) * height));
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.strokeStyle = "#ff7060";
      context.lineWidth = 1.6;
      context.stroke();
    };

    const updateLiveSpectrum = () => {
      if (!analyser || !liveBins || !liveSpectrum) return;
      analyser.getFloatFrequencyData(liveBins);
      const firstBin = Math.max(0, Math.floor((MIN_FREQUENCY * analyser.fftSize) / analyser.context.sampleRate));
      const lastBin = Math.min(liveBins.length - 1, Math.ceil((MAX_FREQUENCY * analyser.fftSize) / analyser.context.sampleRate));
      let peak = -Infinity;
      for (let index = firstBin; index <= lastBin; index += 1) {
        if (Number.isFinite(liveBins[index])) peak = Math.max(peak, liveBins[index]);
      }
      for (let index = 0; index < liveBins.length; index += 1) {
        liveBins[index] = Number.isFinite(liveBins[index]) && Number.isFinite(peak) && !(sourceMode === "microphone" && peak < -72)
          ? Math.max(-90, Math.min(0, liveBins[index] - peak))
          : -90;
      }
    };

    const animate = (time: number) => {
      if (time - lastFrameTime >= 1000 / 30) {
        updateLiveSpectrum();
        draw(liveSpectrum);
        lastFrameTime = time;
      }
      animationFrame = requestAnimationFrame(animate);
    };

    resize();
    draw(spectrum);
    if (live && analyser) animationFrame = requestAnimationFrame(animate);
    const observer = new ResizeObserver(() => {
      resize();
      draw(live && liveSpectrum ? liveSpectrum : spectrum);
    });
    observer.observe(canvas);
    return () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      activeSpectrumRef.current = null;
    };
  }, [spectrum, analyser, live, sourceMode, pinkTiltEnabled, detectionSensitivity]);

  const updateHover = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const info = hoverFromUnit((event.clientX - rect.left) / rect.width, activeSpectrumRef.current);
    setHover(info);
    if (auditionEnabled && auditioningRef.current) onAudition(midiToFrequency(info.midi));
  };

  const clickSpectrum = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest(".spectrum-drop-prompt")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onToggle(hoverFromUnit((event.clientX - rect.left) / rect.width, activeSpectrumRef.current).pitchClass);
  };

  const noteFrequencyAtPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const info = hoverFromUnit((event.clientX - rect.left) / rect.width, activeSpectrumRef.current);
    return midiToFrequency(info.midi);
  };

  const dropAudio = (event: DragEvent<HTMLDivElement>) => {
    if (isPanelDrag(event)) return;
    event.preventDefault();
    onDraggingChange(false);
    onFileDrop(event.dataTransfer.files[0]);
  };

  return (
    <div className="spectrum-shell">
      <div className="spectrum-toolbar">
        <div className="spectrum-source-switch" role="group" aria-label="Spectrum input source">
          <button
            type="button"
            className={sourceMode === "file" ? "is-active" : ""}
            aria-pressed={sourceMode === "file"}
            onClick={onSelectFileSource}
          >
            Audio file
          </button>
          <button
            type="button"
            className={sourceMode === "microphone" ? "is-active is-live" : ""}
            aria-pressed={sourceMode === "microphone"}
            disabled={microphoneState === "starting"}
            onClick={onSelectMicrophoneSource}
          >
            <i /> {microphoneState === "starting" ? "Starting…" : "Microphone"}
          </button>
        </div>
        <div className="spectrum-detector-controls">
          <button
            type="button"
            className={`spectrum-option-button ${pinkTiltEnabled ? "is-active" : ""}`}
            aria-pressed={pinkTiltEnabled}
            title="Compensate the display and detector by +3.01 dB per octave"
            onClick={() => setPinkTiltEnabled((enabled) => !enabled)}
          >
            Pink tilt <small>3.01 dB/oct</small>
          </button>
          <label className="spectrum-sensitivity-control">
            <span>Sensitivity</span>
            <input
              type="range"
              min="-100"
              max="100"
              value={detectionSensitivity}
              aria-label="Note detection sensitivity"
              onChange={(event) => setDetectionSensitivity(Number(event.target.value))}
            />
            <output>{detectionSensitivity}%</output>
          </label>
        </div>
        <span className="spectrum-toolbar__message">{detectMessage}</span>
        <button
          type="button"
          className="detect-notes-button"
          disabled={!spectrum && !(live && analyser)}
          onClick={() => {
            const notes = detectionAnalysisRef.current.pitchClasses;
            onDetected(notes);
            setDetectMessage(notes.length
              ? `${notes.length} pitch ${notes.length === 1 ? "class" : "classes"} selected · shown in every octave`
              : "No clear notes detected");
          }}
        >
          ◎ Detect
        </button>
      </div>
      <div
        className="spectrum-stage"
        onPointerMove={updateHover}
        onPointerDown={(event) => {
          if (!auditionEnabled || event.button !== 0 || (event.target as HTMLElement).closest(".spectrum-drop-prompt")) return;
          auditioningRef.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          onAudition(noteFrequencyAtPointer(event));
        }}
        onPointerUp={(event) => {
          if (!auditioningRef.current) return;
          auditioningRef.current = false;
          event.currentTarget.releasePointerCapture(event.pointerId);
          onAuditionEnd();
        }}
        onPointerCancel={() => {
          auditioningRef.current = false;
          onAuditionEnd();
        }}
        onLostPointerCapture={() => {
          if (auditioningRef.current) {
            auditioningRef.current = false;
            onAuditionEnd();
          }
        }}
        onPointerLeave={() => setHover(null)}
        onClick={clickSpectrum}
        onDragEnter={(event) => {
          if (isPanelDrag(event)) return;
          event.preventDefault();
          onDraggingChange(true);
        }}
        onDragOver={(event) => {
          if (!isPanelDrag(event)) event.preventDefault();
        }}
        onDragLeave={(event) => {
          if (isPanelDrag(event)) return;
          if (!event.currentTarget.contains(event.relatedTarget as Node)) onDraggingChange(false);
        }}
        onDrop={dropAudio}
        role={hasFile || microphoneState === "active" ? "button" : undefined}
        tabIndex={hasFile || microphoneState === "active" ? 0 : -1}
        aria-label={hasFile || microphoneState === "active" ? "Frequency spectrum. Hold to hear a note; release to stop; click to select it." : undefined}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && hover) onToggle(hover.pitchClass);
        }}
      >
        <canvas ref={canvasRef} />
        {sourceMode === "file" && !hasFile && !busy && (
          <div className={`spectrum-drop-prompt ${dragging ? "is-dragging" : ""}`}>
            <span className="spectrum-drop-prompt__icon">↓</span>
            <strong>{dragging ? "Drop to analyze" : "Drop an audio file here"}</strong>
            <small>WAV, MP3, M4A/AAC or FLAC</small>
            <button type="button" className="secondary-button" onClick={(event) => { event.stopPropagation(); onChooseFile(); }}>
              Choose file
            </button>
          </div>
        )}
        {sourceMode === "microphone" && microphoneState === "starting" && (
          <div className="spectrum-drop-prompt spectrum-microphone-prompt">
            <span className="microphone-pulse"><i /></span>
            <strong>Waiting for microphone permission…</strong>
            <small>Choose Allow in the browser prompt</small>
          </div>
        )}
        {dragging && <div className="spectrum-replace-overlay">Drop to switch to an audio file</div>}
        {busy && !live && <div className="analysis-status"><span /> Analyzing selection…</div>}
        {live && analyser && (
          <div className={`live-spectrum-badge ${sourceMode === "microphone" ? "is-microphone" : ""}`}>
            <span /> {sourceMode === "microphone" ? "Microphone input" : "Live spectrum"}
          </div>
        )}
        {(spectrum || (live && analyser)) && (
          <div className="detector-candidates-badge">
            <i /> <span ref={detectorReadoutRef}>No detector candidates</span>
          </div>
        )}
        {hover && (
          <>
            <div
              className="note-band"
              style={{ left: `${hover.lowerUnit * 100}%`, width: `${(hover.upperUnit - hover.lowerUnit) * 100}%` }}
            />
            <div className="frequency-cursor" style={{ left: `${hover.unit * 100}%` }} />
            <div
              className="spectrum-tooltip"
              style={{ left: `${Math.max(10, Math.min(90, hover.unit * 100))}%` }}
            >
              <strong>{NOTE_NAMES[hover.pitchClass]}{Math.floor(hover.midi / 12) - 1}</strong>
              <span>{hover.frequency.toFixed(1)} Hz · {hover.cents >= 0 ? "+" : ""}{hover.cents.toFixed(0)} ct</span>
              <span>{hover.db.toFixed(1)} dB</span>
            </div>
          </>
        )}
      </div>
      <div className="spectrum-piano" role="group" aria-label="Piano keyboard A0–C8">
        {MIDIS.map((midi) => {
          const note = asPitchClass(midi);
          const black = BLACK_CLASSES.has(note);
          return (
            <button
              type="button"
              key={midi}
              className={`${black ? "spectrum-key--black" : "spectrum-key--white"} ${selected.has(note) ? "is-selected" : ""} ${previewed.has(note) && !selected.has(note) ? "is-previewed" : ""}`}
              aria-label={`${NOTE_NAMES[note]}${Math.floor(midi / 12) - 1}`}
              aria-pressed={selected.has(note)}
              onClick={() => onToggle(note)}
              onPointerEnter={() => setHover(hoverFromUnit(frequencyToUnit(midiToFrequency(midi)), activeSpectrumRef.current))}
              onPointerLeave={() => setHover(null)}
            >
              {note === 0 && <span>C{Math.floor(midi / 12) - 1}</span>}
            </button>
          );
        })}
        {hover && (
          <div
            className="note-band note-band--keys"
            style={{ left: `${hover.lowerUnit * 100}%`, width: `${(hover.upperUnit - hover.lowerUnit) * 100}%` }}
          />
        )}
      </div>
      <div className="spectrum-axis">
        <span>{midiToFrequency(MIN_MIDI).toFixed(1)} Hz · A0</span>
        <span>440 Hz · A4</span>
        <span>{midiToFrequency(MAX_MIDI).toFixed(0)} Hz · C8</span>
      </div>
    </div>
  );
}
