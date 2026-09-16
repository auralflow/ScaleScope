import { NOTE_NAMES, asPitchClass, type PitchClass } from "../music";

interface PianoKeyboardProps {
  selected: ReadonlySet<PitchClass>;
  previewed: ReadonlySet<PitchClass>;
  onToggle: (note: PitchClass) => void;
}

const WHITE_CLASSES = new Set([0, 2, 4, 5, 7, 9, 11]);
const keys = Array.from({ length: 25 }, (_, index) => 48 + index);
const whiteKeys = keys.filter((midi) => WHITE_CLASSES.has(asPitchClass(midi)));
const blackKeys = keys.filter((midi) => !WHITE_CLASSES.has(asPitchClass(midi)));

function octaveForMidi(midi: number): number {
  return Math.floor(midi / 12) - 1;
}

export function PianoKeyboard({ selected, previewed, onToggle }: PianoKeyboardProps) {
  return (
    <div className="manual-piano" role="group" aria-label="Select notes on the virtual keyboard">
      <div className="manual-white-keys">
        {whiteKeys.map((midi) => {
          const note = asPitchClass(midi);
          return (
            <button
              type="button"
              key={midi}
              className={`manual-key manual-key--white ${selected.has(note) ? "is-selected" : ""} ${previewed.has(note) && !selected.has(note) ? "is-previewed" : ""}`}
              aria-pressed={selected.has(note)}
              aria-label={`${NOTE_NAMES[note]}, octave ${octaveForMidi(midi)}`}
              onClick={() => onToggle(note)}
            >
              <span>{note === 0 ? `C${octaveForMidi(midi)}` : NOTE_NAMES[note]}</span>
            </button>
          );
        })}
      </div>
      {blackKeys.map((midi) => {
        const note = asPitchClass(midi);
        const previousWhiteIndex = whiteKeys.filter((whiteMidi) => whiteMidi < midi).length - 1;
        const left = ((previousWhiteIndex + 1) / whiteKeys.length) * 100;
        return (
          <button
            type="button"
            key={midi}
            className={`manual-key manual-key--black ${selected.has(note) ? "is-selected" : ""} ${previewed.has(note) && !selected.has(note) ? "is-previewed" : ""}`}
            style={{ left: `${left}%` }}
            aria-pressed={selected.has(note)}
            aria-label={`${NOTE_NAMES[note]}, octave ${octaveForMidi(midi)}`}
            onClick={() => onToggle(note)}
          >
            <span>{NOTE_NAMES[note].split("/")[0]}</span>
          </button>
        );
      })}
    </div>
  );
}
