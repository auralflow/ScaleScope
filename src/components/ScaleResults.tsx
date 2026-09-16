import { useMemo, useState } from "react";
import {
  NOTE_NAMES,
  findScaleMatches,
  formatNoteList,
  listScaleOptions,
  type PitchClass,
  type ScaleMatch,
} from "../music";

interface ScaleResultsProps {
  selected: ReadonlySet<PitchClass>;
  onPreview: (notes: readonly PitchClass[] | null) => void;
  onApply: (notes: readonly PitchClass[]) => void;
}

function normalizeSearch(value: string): string {
  return value
    .toLocaleLowerCase()
    .replaceAll("♯", "#")
    .replaceAll("♭", "b")
    .replace(/[^a-z0-9#]+/g, " ")
    .trim();
}

function matchesSearch(match: ScaleMatch, query: string): boolean {
  const terms = normalizeSearch(query).split(" ").filter(Boolean);
  if (!terms.length) return true;
  const rootNames = normalizeSearch(NOTE_NAMES[match.roots[0]]).split(" ").filter(Boolean);
  const searchable = normalizeSearch([
    match.scale.name,
    NOTE_NAMES[match.roots[0]],
    formatNoteList(match.orderedNotes),
  ].join(" "));
  const [first, ...rest] = terms;
  if (rootNames.includes(first)) return rest.every((term) => searchable.includes(term));
  return terms.every((term) => searchable.includes(term));
}

export function ScaleResults({ selected, onPreview, onApply }: ScaleResultsProps) {
  const [query, setQuery] = useState("");
  const catalog = useMemo(() => listScaleOptions(), []);
  const searching = normalizeSearch(query).length > 0;
  const matches = useMemo(() => {
    if (searching || selected.size === 0) return catalog;
    return findScaleMatches(selected);
  }, [catalog, searching, selected]);
  const visibleMatches = useMemo(
    () => matches.filter((match) => matchesSearch(match, query)),
    [matches, query],
  );
  const browsing = selected.size === 0 || searching;

  return (
    <div className="scale-results">
      <label className="scale-search">
        <span>⌕</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search root, scale or note · e.g. D Dorian"
          aria-label="Search scales by root, name, or note"
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} aria-label="Clear scale search">×</button>
        )}
      </label>
      <div className="results-summary">
        <span>{visibleMatches.length}{visibleMatches.length !== matches.length ? ` of ${matches.length}` : ""} {searching ? "search results" : browsing ? "scale/key options" : "compatible matches"}</span>
        <span>{browsing ? "Click a card to select" : `${matches.filter((match) => match.exact).length} exact`}</span>
      </div>
      <div className="scale-list">
        {visibleMatches.map((match) => (
          <article
            className={`scale-card ${match.exact ? "is-exact" : ""}`}
            key={`${match.scale.id}-${match.roots[0]}`}
            role="button"
            tabIndex={0}
            title="Preview on the keyboard · Click to select the full scale"
            onMouseEnter={() => onPreview(match.orderedNotes)}
            onMouseLeave={() => onPreview(null)}
            onFocus={() => onPreview(match.orderedNotes)}
            onBlur={() => onPreview(null)}
            onClick={() => onApply(match.orderedNotes)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onApply(match.orderedNotes);
              }
            }}
          >
            <div className="scale-card__topline">
              <div>
                <span className="scale-card__root">
                  {match.roots.map((root) => NOTE_NAMES[root]).join(" / ")}
                </span>
                <h3>{match.scale.name}</h3>
              </div>
              {match.exact ? (
                <span className="match-badge match-badge--exact">Exact</span>
              ) : browsing ? (
                <span className="match-badge">Apply</span>
              ) : (
                <span className="match-badge">+{match.extraCount}</span>
              )}
            </div>
            <p className="scale-card__notes">{formatNoteList(match.orderedNotes)}</p>
          </article>
        ))}
        {!visibleMatches.length && (
          <div className="scale-search-empty">No scale or key matches “{query}”.</div>
        )}
      </div>
    </div>
  );
}
