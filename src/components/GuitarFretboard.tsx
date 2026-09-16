import { GUITAR_MAX_FRET, STANDARD_GUITAR_TUNING, fretWidthRatio, guitarPosition } from "../guitar";
import { NOTE_NAMES, type PitchClass } from "../music";

interface GuitarFretboardProps {
  selected: ReadonlySet<PitchClass>;
  previewed: ReadonlySet<PitchClass>;
  onToggle: (note: PitchClass) => void;
}

const FRETS = Array.from({ length: GUITAR_MAX_FRET + 1 }, (_, fret) => fret);
const MARKED_FRETS = [3, 5, 7, 9, 12, 15, 17, 19];
const FRET_GRID_COLUMNS = [
  "48px",
  "58px",
  ...Array.from({ length: GUITAR_MAX_FRET }, (_, index) => `${fretWidthRatio(index + 1).toFixed(5)}fr`),
].join(" ");

function shortName(note: PitchClass): string {
  return NOTE_NAMES[note].split("/")[0];
}

export function GuitarFretboard({ selected, previewed, onToggle }: GuitarFretboardProps) {
  return (
    <section className="guitar-view" aria-labelledby="guitar-title">
      <div className="guitar-view__heading">
        <div>
          <span className="eyebrow">Instrument view</span>
          <h2 id="guitar-title">Guitar fretboard</h2>
        </div>
        <span>Standard tuning · E–A–D–G–B–E · 20 frets</span>
      </div>

      <div className="guitar-scroll">
        <div
          className="guitar-grid"
          role="group"
          aria-label="Interactive guitar fretboard in standard tuning"
          style={{ gridTemplateColumns: FRET_GRID_COLUMNS }}
        >
          <div className="guitar-grid__corner">String</div>
          {FRETS.map((fret) => (
            <div className={`guitar-fret-number ${fret === 0 ? "is-open" : ""}`} key={`header-${fret}`}>
              <span>{fret === 0 ? "Open" : fret}</span>
            </div>
          ))}

          {STANDARD_GUITAR_TUNING.map((string, stringIndex) => (
            <div className="guitar-string-row" style={{ gridRow: stringIndex + 2 }} key={string.id}>
              <div className="guitar-string-label">
                <strong>{string.label[0]}</strong>
                <span>{string.label.slice(1)}</span>
              </div>
              {FRETS.map((fret) => {
                const position = guitarPosition(string.midi, fret);
                const isSelected = selected.has(position.pitchClass);
                const isPreviewed = previewed.has(position.pitchClass) && !isSelected;
                const fretLabel = fret === 0 ? "open string" : `fret ${fret}`;
                return (
                  <button
                    type="button"
                    className={`guitar-position ${isSelected ? "is-selected" : ""} ${isPreviewed ? "is-previewed" : ""}`}
                    style={{ "--string-gauge": `${string.gauge}px` } as React.CSSProperties}
                    data-fret={fret}
                    key={`${string.id}-${fret}`}
                    aria-label={`${NOTE_NAMES[position.pitchClass]}${position.octave}, ${string.label} string, ${fretLabel}`}
                    aria-pressed={isSelected}
                    title={`${NOTE_NAMES[position.pitchClass]}${position.octave} · ${string.label} · ${fretLabel}`}
                    onClick={() => onToggle(position.pitchClass)}
                  >
                    <span className="guitar-note">{shortName(position.pitchClass)}</span>
                  </button>
                );
              })}
              <span className="guitar-string-order" aria-hidden="true">{stringIndex + 1}</span>
            </div>
          ))}
          <div className="guitar-inlays" aria-hidden="true">
            {MARKED_FRETS.map((fret) => (
              <i
                className={`guitar-inlay ${fret === 12 ? "is-double" : ""}`}
                key={`inlay-${fret}`}
                style={{ gridColumn: fret + 1 }}
              />
            ))}
          </div>
        </div>
        <div
          className="guitar-marker-grid"
          aria-hidden="true"
          style={{ gridTemplateColumns: FRET_GRID_COLUMNS }}
        >
          <span className="guitar-marker-grid__corner" />
          {FRETS.map((fret) => {
            const marked = MARKED_FRETS.includes(fret);
            return (
              <span className={`guitar-fret-marker ${marked ? "is-marked" : ""} ${fret === 12 ? "is-double" : ""}`} key={`marker-${fret}`}>
                {marked && <i />}
                {fret === 12 && <i />}
              </span>
            );
          })}
        </div>
      </div>
      <div className="guitar-legend" aria-hidden="true">
        <span><i className="guitar-legend__selected" /> Selected</span>
        <span><i className="guitar-legend__preview" /> Scale preview</span>
        <span>Click any position to toggle its note everywhere</span>
      </div>
    </section>
  );
}
