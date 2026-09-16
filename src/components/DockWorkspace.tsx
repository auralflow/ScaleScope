import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_DOCK_LAYOUT,
  PANEL_IDS,
  activatePanel,
  movePanel,
  normalizeDockLayout,
  resizeDockColumns,
  resizeDockRow,
  type DockLayoutState,
  type DockPlacement,
  type DockRow,
  type DockStack,
  type PanelId,
} from "../dock-layout";

interface DockWorkspaceProps {
  panels: Record<PanelId, ReactNode>;
  onResetLayoutReady?: (reset: (() => void) | null) => void;
}

interface StackFrame {
  row: DockRow;
  stack: DockStack;
  rowIndex: number;
  stackIndex: number;
  top: number;
  left: string;
  width: string;
}

const STORAGE_KEY = "scale-scope:dock-layout:v1";
const LEGACY_STORAGE_KEY = "scale-finder:dock-layout:v1";
const ROW_GAP = 18;
const COLUMN_GAP = 18;

const PANEL_LABELS: Record<PanelId, { short: string; title: string }> = {
  keyboard: { short: "Keys", title: "Notes & piano" },
  guitar: { short: "Guitar", title: "Guitar fretboard" },
  scales: { short: "Scales", title: "Compatible scales" },
  camelot: { short: "Camelot", title: "Camelot wheel" },
  audio: { short: "Audio", title: "Spectrum analyzer" },
};

function loadLayout(): DockLayoutState {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY);
    return saved ? normalizeDockLayout(JSON.parse(saved)) : normalizeDockLayout(DEFAULT_DOCK_LAYOUT);
  } catch {
    return normalizeDockLayout(DEFAULT_DOCK_LAYOUT);
  }
}

function buildFrames(layout: DockLayoutState): StackFrame[] {
  const frames: StackFrame[] = [];
  let top = 0;
  layout.rows.forEach((row, rowIndex) => {
    const totalColumnGap = COLUMN_GAP * (row.columns.length - 1);
    let widthBefore = 0;
    row.columns.forEach((stack, stackIndex) => {
      frames.push({
        row,
        stack,
        rowIndex,
        stackIndex,
        top,
        left: `calc(${widthBefore * 100}% + ${COLUMN_GAP * (stackIndex - widthBefore * (row.columns.length - 1))}px)`,
        width: `calc(${stack.width * 100}% - ${stack.width * totalColumnGap}px)`,
      });
      widthBefore += stack.width;
    });
    top += row.height + ROW_GAP;
  });
  return frames;
}

function placementAtPoint(element: HTMLElement, clientX: number, clientY: number): DockPlacement {
  const rect = element.getBoundingClientRect();
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  if (y < 0.23) return "top";
  if (y > 0.77) return "bottom";
  if (x < 0.23) return "left";
  if (x > 0.77) return "right";
  return "center";
}

function dropLabel(placement: DockPlacement): string {
  if (placement === "center") return "Add as tab";
  return `Dock ${placement}`;
}

export function DockWorkspace({ panels, onResetLayoutReady }: DockWorkspaceProps) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState(loadLayout);
  const [draggedPanel, setDraggedPanel] = useState<PanelId | null>(null);
  const [dragPointer, setDragPointer] = useState<{ x: number; y: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ stackId: string; placement: DockPlacement } | null>(null);
  const frames = buildFrames(layout);
  const totalHeight = layout.rows.reduce((sum, row) => sum + row.height, 0) + ROW_GAP * (layout.rows.length - 1);

  const resetLayout = useCallback(() => {
    setLayout(normalizeDockLayout(DEFAULT_DOCK_LAYOUT));
  }, []);

  useEffect(() => {
    onResetLayoutReady?.(resetLayout);
    return () => onResetLayoutReady?.(null);
  }, [onResetLayoutReady, resetLayout]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      // The layout remains usable if browser storage is unavailable.
    }
  }, [layout]);

  const startRowResize = (event: ReactPointerEvent<HTMLButtonElement>, row: DockRow) => {
    event.preventDefault();
    const startY = event.clientY;
    const initial = layout;
    document.body.classList.add("is-dock-resizing", "is-dock-resizing--row");
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      setLayout(resizeDockRow(initial, row.id, row.height + moveEvent.clientY - startY));
    };
    const onUp = () => {
      document.body.classList.remove("is-dock-resizing", "is-dock-resizing--row");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };

  const startColumnResize = (
    event: ReactPointerEvent<HTMLButtonElement>,
    row: DockRow,
    dividerIndex: number,
  ) => {
    event.preventDefault();
    const startX = event.clientX;
    const initial = layout;
    const width = workspaceRef.current?.getBoundingClientRect().width || 1;
    document.body.classList.add("is-dock-resizing", "is-dock-resizing--column");
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      setLayout(resizeDockColumns(initial, row.id, dividerIndex, (moveEvent.clientX - startX) / width));
    };
    const onUp = () => {
      document.body.classList.remove("is-dock-resizing", "is-dock-resizing--column");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };

  const startPanelDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    panel: PanelId,
    sourceStackId: string,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;
    let currentTarget: { stackId: string; placement: DockPlacement } | null = null;

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
      if (!dragging && distance < 6) return;
      if (!dragging) {
        dragging = true;
        setDraggedPanel(panel);
        document.body.classList.add("is-dock-panel-dragging");
      }
      setDragPointer({ x: moveEvent.clientX, y: moveEvent.clientY });
      const panelElement = document.elementsFromPoint(moveEvent.clientX, moveEvent.clientY)
        .map((element) => element.closest<HTMLElement>(".dock-panel.is-active"))
        .find((element): element is HTMLElement => Boolean(element));
      const targetStackId = panelElement?.dataset.stackId;
      if (!panelElement || !targetStackId) {
        currentTarget = null;
        setDropTarget(null);
        return;
      }
      currentTarget = {
        stackId: targetStackId,
        placement: placementAtPoint(panelElement, moveEvent.clientX, moveEvent.clientY),
      };
      setDropTarget(currentTarget);
    };

    const finish = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      document.body.classList.remove("is-dock-panel-dragging");
      if (dragging && currentTarget) {
        setLayout((current) => movePanel(current, panel, currentTarget!.stackId, currentTarget!.placement));
      } else if (!dragging) {
        setLayout((current) => activatePanel(current, sourceStackId, panel));
      }
      setDraggedPanel(null);
      setDragPointer(null);
      setDropTarget(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  };

  return (
    <section className="dock-area" aria-label="Customizable workspace">
      <div
        ref={workspaceRef}
        className={`dock-workspace ${draggedPanel ? "is-dragging-panel" : ""}`}
        style={{ height: totalHeight }}
      >
        {PANEL_IDS.map((panelId) => {
          const frame = frames.find(({ stack }) => stack.panels.includes(panelId));
          if (!frame) return null;
          const active = frame.stack.active === panelId;
          const target = dropTarget?.stackId === frame.stack.id ? dropTarget : null;
          const style = {
            top: frame.top,
            left: frame.left,
            width: frame.width,
            height: frame.row.height,
          } as CSSProperties;

          return (
            <article
              className={`dock-panel ${active ? "is-active" : "is-inactive"}`}
              style={style}
              key={panelId}
              data-stack-id={frame.stack.id}
              aria-label={PANEL_LABELS[panelId].title}
            >
              <nav className="dock-tabs" aria-label={`${PANEL_LABELS[panelId].title} tabs`}>
                <span className="dock-grip" aria-hidden="true">⠿</span>
                {frame.stack.panels.map((tab) => (
                  <button
                    type="button"
                    className={`dock-tab ${frame.stack.active === tab ? "is-active" : ""}`}
                    aria-selected={frame.stack.active === tab}
                    key={tab}
                    onClick={(event) => {
                      if (event.detail === 0) setLayout((current) => activatePanel(current, frame.stack.id, tab));
                    }}
                    onPointerDown={(event) => startPanelDrag(event, tab, frame.stack.id)}
                  >
                    {PANEL_LABELS[tab].short}
                  </button>
                ))}
                <span className="dock-tabs__hint">DRAG TAB</span>
              </nav>
              <div className="dock-panel__content">{panels[panelId]}</div>
              {target && (
                <div className={`dock-drop-preview is-${target.placement}`} aria-hidden="true">
                  <span>{dropLabel(target.placement)}</span>
                </div>
              )}
            </article>
          );
        })}

        {frames.filter(({ stackIndex }) => stackIndex > 0).map((frame) => (
          <button
            type="button"
            className="dock-resizer dock-resizer--column"
            style={{ top: frame.top, left: `calc(${frame.left} - ${COLUMN_GAP / 2}px)`, height: frame.row.height }}
            key={`column-${frame.row.id}-${frame.stack.id}`}
            aria-label="Resize panels horizontally"
            onPointerDown={(event) => startColumnResize(event, frame.row, frame.stackIndex - 1)}
          ><i /></button>
        ))}

        {layout.rows.map((row, rowIndex) => {
          if (rowIndex === layout.rows.length - 1) return null;
          const top = layout.rows.slice(0, rowIndex + 1).reduce((sum, item) => sum + item.height, 0) + ROW_GAP * rowIndex;
          return (
            <button
              type="button"
              className="dock-resizer dock-resizer--row"
              style={{ top }}
              key={`row-${row.id}`}
              aria-label="Resize panel row vertically"
              onPointerDown={(event) => startRowResize(event, row)}
            ><i /></button>
          );
        })}
        {draggedPanel && dragPointer && (
          <div
            className="dock-drag-ghost"
            style={{ left: dragPointer.x, top: dragPointer.y }}
            aria-hidden="true"
          >
            <span>⠿</span> {PANEL_LABELS[draggedPanel].title}
          </div>
        )}
      </div>
    </section>
  );
}
