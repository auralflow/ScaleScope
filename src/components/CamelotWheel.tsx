import { useMemo } from "react";
import { NOTE_NAMES, type PitchClass } from "../music";
import { scoreCamelot, type ScoredCamelotSector } from "../camelot";

interface CamelotWheelProps {
  selected: ReadonlySet<PitchClass>;
  onPreview: (notes: readonly PitchClass[] | null) => void;
  onApply: (notes: readonly PitchClass[]) => void;
}

function heatColor(sector: ScoredCamelotSector, major: boolean): string {
  if (sector.score === 0) return major ? "#24272d" : "#1b1d22";
  const alpha = 0.16 + sector.score * 0.72;
  return major ? `rgba(255, 101, 79, ${alpha})` : `rgba(170, 80, 255, ${alpha})`;
}

function gradientFor(sectors: ScoredCamelotSector[], mode: "major" | "minor"): string {
  const filtered = sectors.filter((sector) => sector.mode === mode);
  const stops = filtered.flatMap((sector, index) => {
    const start = index * 30;
    const end = (index + 1) * 30;
    const color = heatColor(sector, mode === "major");
    return [`${color} ${start}deg`, `${color} ${end - 0.8}deg`, `#0c0d10 ${end - 0.8}deg`, `#0c0d10 ${end}deg`];
  });
  return `conic-gradient(from -15deg, ${stops.join(", ")})`;
}

function sectorTitle(sector: ScoredCamelotSector, selected: ReadonlySet<PitchClass>): string {
  if (selected.size === 0) return `${sector.code} · ${sector.label}`;
  const missing = sector.missing.length ? sector.missing.map((note) => NOTE_NAMES[note]).join(", ") : "none";
  return `${sector.code} · ${sector.label}\nMatched: ${sector.matched}/${selected.size}\nOutside key: ${missing}`;
}

export function CamelotWheel({ selected, onPreview, onApply }: CamelotWheelProps) {
  const sectors = useMemo(() => scoreCamelot(selected), [selected]);
  const outer = sectors.filter((sector) => sector.mode === "major");
  const inner = sectors.filter((sector) => sector.mode === "minor");

  return (
    <div className="camelot-block">
      <div className="camelot-wheel" aria-label="Camelot compatibility heat map">
        <div className="camelot-ring camelot-ring--outer" style={{ background: gradientFor(sectors, "major") }} />
        <div className="camelot-ring camelot-ring--inner" style={{ background: gradientFor(sectors, "minor") }} />
        <div className="camelot-center">
          <span>CAMELOT</span>
          <strong>{selected.size || "—"}</strong>
          <small>{selected.size ? "notes selected" : "no selection"}</small>
        </div>
        {[...outer, ...inner].map((sector) => {
          const radius = sector.mode === "major" ? 43 : 29;
          const angle = (sector.number - 1) * 30;
          return (
            <button
              type="button"
              key={sector.code}
              className={`camelot-label camelot-label--${sector.mode} ${sector.compatible ? "is-compatible" : ""}`}
              style={{
                left: `${50 + radius * Math.sin((angle * Math.PI) / 180)}%`,
                top: `${50 - radius * Math.cos((angle * Math.PI) / 180)}%`,
              }}
              title={sectorTitle(sector, selected)}
              aria-label={sectorTitle(sector, selected)}
              onMouseEnter={() => onPreview(sector.notes)}
              onMouseLeave={() => onPreview(null)}
              onFocus={() => onPreview(sector.notes)}
              onBlur={() => onPreview(null)}
              onClick={() => onApply(sector.notes)}
            >
              <strong>{sector.code}</strong>
              <span>{sector.label}</span>
            </button>
          );
        })}
      </div>
      <div className="camelot-legend">
        <span><i className="legend-dot legend-dot--minor" /> Minor · A</span>
        <span><i className="legend-dot legend-dot--major" /> Major · B</span>
        <span><i className="legend-ring" /> Fully compatible</span>
      </div>
    </div>
  );
}
