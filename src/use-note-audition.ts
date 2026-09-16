import { useCallback, useEffect, useRef, useState } from "react";

/** Shared sine-tone audition used by the piano and spectrum. */
export function useNoteAudition() {
  const contextRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const enabledRef = useRef(true);
  const volumeRef = useRef(0.2);
  const [enabled, setEnabled] = useState(true);
  const [volume, setVolume] = useState(20);

  const stop = useCallback(() => {
    const context = contextRef.current;
    const oscillator = oscillatorRef.current;
    const gain = gainRef.current;
    if (!context || !oscillator || !gain) return;
    gain.gain.cancelScheduledValues(context.currentTime);
    gain.gain.setTargetAtTime(0.0001, context.currentTime, 0.008);
    oscillator.stop(context.currentTime + 0.045);
    oscillatorRef.current = null;
    gainRef.current = null;
  }, []);

  const setAuditionEnabled = useCallback((nextEnabled: boolean) => {
    enabledRef.current = nextEnabled;
    setEnabled(nextEnabled);
    if (!nextEnabled) stop();
  }, [stop]);

  const setAuditionVolume = useCallback((nextVolume: number) => {
    const clamped = Math.max(0, Math.min(100, nextVolume));
    volumeRef.current = clamped / 100;
    setVolume(clamped);
    const context = contextRef.current;
    const gain = gainRef.current;
    if (context && gain) gain.gain.setTargetAtTime(Math.max(0.0001, volumeRef.current), context.currentTime, 0.01);
  }, []);

  const audition = useCallback((frequency: number) => {
    if (!enabledRef.current || !Number.isFinite(frequency) || frequency <= 0) return;
    let context = contextRef.current;
    if (!context || context.state === "closed") {
      context = new AudioContext();
      contextRef.current = context;
    }
    if (context.state === "suspended") void context.resume();

    let oscillator = oscillatorRef.current;
    if (!oscillator) {
      oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volumeRef.current), context.currentTime + 0.012);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillatorRef.current = oscillator;
      gainRef.current = gain;
    }
    oscillator.frequency.setTargetAtTime(frequency, context.currentTime, 0.008);
  }, []);

  useEffect(() => () => {
    oscillatorRef.current?.stop();
    oscillatorRef.current = null;
    gainRef.current = null;
    void contextRef.current?.close();
    contextRef.current = null;
  }, []);

  return { enabled, volume, audition, stop, setAuditionEnabled, setAuditionVolume };
}
