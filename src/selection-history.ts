import { asPitchClass, type PitchClass } from "./music.ts";

export interface SelectionHistory {
  past: ReadonlySet<PitchClass>[];
  present: ReadonlySet<PitchClass>;
  future: ReadonlySet<PitchClass>[];
}

const HISTORY_LIMIT = 100;

function normalize(notes: Iterable<number>): ReadonlySet<PitchClass> {
  return new Set([...notes].map(asPitchClass));
}

function equal(left: ReadonlySet<PitchClass>, right: ReadonlySet<PitchClass>): boolean {
  return left.size === right.size && [...left].every((note) => right.has(note));
}

export function createSelectionHistory(notes: Iterable<number> = []): SelectionHistory {
  return { past: [], present: normalize(notes), future: [] };
}

export function commitSelection(history: SelectionHistory, notes: Iterable<number>): SelectionHistory {
  const next = normalize(notes);
  if (equal(history.present, next)) return history;
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: next,
    future: [],
  };
}

export function undoSelection(history: SelectionHistory): SelectionHistory {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future].slice(0, HISTORY_LIMIT),
  };
}

export function redoSelection(history: SelectionHistory): SelectionHistory {
  const next = history.future[0];
  if (!next) return history;
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: next,
    future: history.future.slice(1),
  };
}
