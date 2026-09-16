import { useCallback, useEffect, useState } from "react";
import { AudioAnalyzer } from "./components/AudioAnalyzer";
import { CamelotWheel } from "./components/CamelotWheel";
import { DockWorkspace } from "./components/DockWorkspace";
import { GuitarFretboard } from "./components/GuitarFretboard";
import { PianoKeyboard } from "./components/PianoKeyboard";
import { ScaleResults } from "./components/ScaleResults";
import { NOTE_NAMES, type PitchClass } from "./music";
import {
  commitSelection as commitSelectionHistory,
  createSelectionHistory,
  redoSelection,
  undoSelection,
} from "./selection-history";

type SelectionUpdate = Iterable<number> | ((current: ReadonlySet<PitchClass>) => Iterable<number>);

export default function App() {
  const [history, setHistory] = useState(createSelectionHistory);
  const [previewed, setPreviewed] = useState<Set<PitchClass>>(() => new Set());
  const selected = history.present;

  const commitSelection = useCallback((update: SelectionUpdate) => {
    setHistory((current) => commitSelectionHistory(
      current,
      typeof update === "function" ? update(current.present) : update,
    ));
    setPreviewed(new Set());
  }, []);

  const toggleNote = useCallback((note: PitchClass) => {
    commitSelection((current) => {
      const next = new Set(current);
      if (next.has(note)) next.delete(note);
      else next.add(note);
      return next;
    });
  }, [commitSelection]);

  const applyScale = useCallback((notes: readonly PitchClass[]) => {
    commitSelection(notes);
  }, [commitSelection]);

  const applyDetectedNotes = useCallback((notes: readonly PitchClass[]) => {
    commitSelection(notes);
  }, [commitSelection]);

  const undo = useCallback(() => {
    setHistory(undoSelection);
    setPreviewed(new Set());
  }, []);

  const redo = useCallback(() => {
    setHistory(redoSelection);
    setPreviewed(new Set());
  }, []);

  useEffect(() => {
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const undoPressed = event.code === "KeyZ" && !event.shiftKey;
      const redoPressed = (event.code === "KeyZ" && event.shiftKey) || event.code === "KeyY";
      if (!undoPressed && !redoPressed) return;
      event.preventDefault();
      if (undoPressed) undo();
      else redo();
    };

    window.addEventListener("keydown", handleHistoryShortcut);
    return () => window.removeEventListener("keydown", handleHistoryShortcut);
  }, [redo, undo]);

  const selectedInOrder = [...selected].sort((a, b) => a - b);

  return (
    <main>
      <header className="app-header">
        <a className="brand" href="#top" aria-label="ScaleScope, back to top">
          <span className="brand-mark"><i /><i /><i /></span>
          <span>
            <strong>SCALESCOPE</strong>
            <small>KORG ELECTRIBE 2</small>
          </span>
        </a>
        <div className="header-status">
          <span className="offline-pill"><i /> OFFLINE</span>
          <span className="version">35 scales · 12 keys</span>
        </div>
      </header>

      <div className="app-shell" id="top">
        <DockWorkspace
          actions={(
            <>
              <div className="history-controls" role="group" aria-label="Global selection history">
                <button type="button" className="history-button" disabled={history.past.length === 0} onClick={undo} title="Undo · Ctrl/Cmd+Z">
                  ↶ Undo
                </button>
                <button type="button" className="history-button" disabled={history.future.length === 0} onClick={redo} title="Redo · Ctrl/Cmd+Shift+Z or Ctrl+Y">
                  ↷ Redo
                </button>
              </div>
              <button
                type="button"
                className="clear-button"
                disabled={selected.size === 0}
                onClick={() => commitSelection([])}
              >
                Clear all
              </button>
            </>
          )}
          panels={{
          keyboard: (
            <section className="note-section" aria-labelledby="notes-title">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">01 · Scale matching</span>
                  <h1 id="notes-title">Which notes are playing?</h1>
                  <p>Click the keys — every note is checked automatically across all transpositions.</p>
                </div>
              </div>

              <div className="selected-strip" aria-live="polite">
                <span className="selected-strip__label">Selected</span>
                <div className="note-chips">
                  {selectedInOrder.length ? selectedInOrder.map((note) => (
                    <button type="button" key={note} className="note-chip" onClick={() => toggleNote(note)} title="Remove note">
                      {NOTE_NAMES[note]} <span>×</span>
                    </button>
                  )) : <span className="selected-placeholder">No notes selected</span>}
                </div>
                <span className="selected-count">{selected.size}/12</span>
              </div>

              <PianoKeyboard selected={selected} previewed={previewed} onToggle={toggleNote} />
            </section>
          ),
          guitar: <GuitarFretboard selected={selected} previewed={previewed} onToggle={toggleNote} />,
          scales: (
            <section className="panel scales-panel" aria-labelledby="scales-title">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Results</span>
                  <h2 id="scales-title">Compatible scales</h2>
                </div>
                <span className="panel-index">35</span>
              </div>
              <ScaleResults
                selected={selected}
                onPreview={(notes) => setPreviewed(new Set(notes ?? []))}
                onApply={applyScale}
              />
            </section>
          ),
          camelot: (
            <section className="panel camelot-panel" aria-labelledby="camelot-title">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Keys</span>
                  <h2 id="camelot-title">Camelot wheel</h2>
                </div>
                <span className="heat-caption">weaker <i /> stronger</span>
              </div>
              <CamelotWheel
                selected={selected}
                onPreview={(notes) => setPreviewed(new Set(notes ?? []))}
                onApply={applyScale}
              />
            </section>
          ),
          audio: (
            <AudioAnalyzer
              selected={selected}
              previewed={previewed}
              onToggle={toggleNote}
              onDetected={applyDetectedNotes}
            />
          ),
          }}
        />
      </div>

      <footer>
        <span>ScaleScope · local music utility</span>
        <span>Your audio never leaves this device</span>
      </footer>
    </main>
  );
}
