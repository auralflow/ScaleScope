export const PANEL_IDS = ["keyboard", "guitar", "scales", "camelot", "audio"] as const;

export type PanelId = (typeof PANEL_IDS)[number];
export type DockPlacement = "top" | "right" | "bottom" | "left" | "center";

export interface DockStack {
  id: string;
  width: number;
  panels: PanelId[];
  active: PanelId;
}

export interface DockRow {
  id: string;
  height: number;
  columns: DockStack[];
}

export interface DockLayoutState {
  version: 1;
  rows: DockRow[];
}

export const DEFAULT_DOCK_LAYOUT: DockLayoutState = {
  version: 1,
  rows: [
    {
      id: "row-keyboard",
      height: 530,
      columns: [{ id: "stack-keyboard", width: 1, panels: ["keyboard"], active: "keyboard" }],
    },
    {
      id: "row-guitar",
      height: 550,
      columns: [{ id: "stack-guitar", width: 1, panels: ["guitar"], active: "guitar" }],
    },
    {
      id: "row-harmony",
      height: 790,
      columns: [
        { id: "stack-scales", width: 0.55, panels: ["scales"], active: "scales" },
        { id: "stack-camelot", width: 0.45, panels: ["camelot"], active: "camelot" },
      ],
    },
    {
      id: "row-audio",
      height: 910,
      columns: [{ id: "stack-audio", width: 1, panels: ["audio"], active: "audio" }],
    },
  ],
};

function cloneLayout(layout: DockLayoutState): DockLayoutState {
  return {
    version: 1,
    rows: layout.rows.map((row) => ({
      ...row,
      columns: row.columns.map((column) => ({ ...column, panels: [...column.panels] })),
    })),
  };
}

function uniqueId(prefix: string, layout: DockLayoutState): string {
  const used = new Set(layout.rows.flatMap((row) => [row.id, ...row.columns.map((column) => column.id)]));
  let index = 1;
  while (used.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

function normalizeWidths(columns: DockStack[]): DockStack[] {
  const total = columns.reduce((sum, column) => sum + Math.max(0.01, column.width), 0);
  return columns.map((column) => ({ ...column, width: Math.max(0.01, column.width) / total }));
}

export function normalizeDockLayout(value: unknown): DockLayoutState {
  if (!value || typeof value !== "object") return cloneLayout(DEFAULT_DOCK_LAYOUT);
  const candidate = value as Partial<DockLayoutState>;
  if (candidate.version !== 1 || !Array.isArray(candidate.rows)) return cloneLayout(DEFAULT_DOCK_LAYOUT);

  const seen = new Set<PanelId>();
  const rows: DockRow[] = [];
  for (const rawRow of candidate.rows) {
    if (!rawRow || typeof rawRow !== "object" || !Array.isArray(rawRow.columns)) continue;
    const columns: DockStack[] = [];
    for (const rawStack of rawRow.columns) {
      if (!rawStack || typeof rawStack !== "object" || !Array.isArray(rawStack.panels)) continue;
      const panels = rawStack.panels.filter((panel): panel is PanelId => (
        PANEL_IDS.includes(panel as PanelId) && !seen.has(panel as PanelId)
      ));
      panels.forEach((panel) => seen.add(panel));
      if (!panels.length) continue;
      const active = panels.includes(rawStack.active as PanelId) ? rawStack.active as PanelId : panels[0];
      columns.push({
        id: typeof rawStack.id === "string" && rawStack.id ? rawStack.id : `stack-${panels[0]}`,
        width: Number.isFinite(rawStack.width) ? Math.max(0.01, Number(rawStack.width)) : 1,
        panels,
        active,
      });
    }
    if (!columns.length) continue;
    rows.push({
      id: typeof rawRow.id === "string" && rawRow.id ? rawRow.id : `row-${rows.length + 1}`,
      height: Number.isFinite(rawRow.height) ? Math.min(1400, Math.max(220, Number(rawRow.height))) : 500,
      columns: normalizeWidths(columns),
    });
  }

  if (seen.size !== PANEL_IDS.length) return cloneLayout(DEFAULT_DOCK_LAYOUT);
  return { version: 1, rows };
}

function locatePanel(layout: DockLayoutState, panel: PanelId) {
  for (let rowIndex = 0; rowIndex < layout.rows.length; rowIndex += 1) {
    const stackIndex = layout.rows[rowIndex].columns.findIndex((stack) => stack.panels.includes(panel));
    if (stackIndex >= 0) return { rowIndex, stackIndex };
  }
  return null;
}

function locateStack(layout: DockLayoutState, stackId: string) {
  for (let rowIndex = 0; rowIndex < layout.rows.length; rowIndex += 1) {
    const stackIndex = layout.rows[rowIndex].columns.findIndex((stack) => stack.id === stackId);
    if (stackIndex >= 0) return { rowIndex, stackIndex };
  }
  return null;
}

export function activatePanel(layout: DockLayoutState, stackId: string, panel: PanelId): DockLayoutState {
  const next = cloneLayout(layout);
  const location = locateStack(next, stackId);
  if (!location) return layout;
  const stack = next.rows[location.rowIndex].columns[location.stackIndex];
  if (!stack.panels.includes(panel)) return layout;
  stack.active = panel;
  return next;
}

export function movePanel(
  layout: DockLayoutState,
  panel: PanelId,
  targetStackId: string,
  placement: DockPlacement,
): DockLayoutState {
  const source = locatePanel(layout, panel);
  const originalTarget = locateStack(layout, targetStackId);
  if (!source || !originalTarget) return layout;
  if (source.rowIndex === originalTarget.rowIndex && source.stackIndex === originalTarget.stackIndex) {
    if (placement === "center") return activatePanel(layout, targetStackId, panel);
    if (layout.rows[source.rowIndex].columns[source.stackIndex].panels.length === 1) return layout;
  }

  const next = cloneLayout(layout);
  const sourceStack = next.rows[source.rowIndex].columns[source.stackIndex];
  sourceStack.panels = sourceStack.panels.filter((item) => item !== panel);
  if (sourceStack.active === panel && sourceStack.panels.length) sourceStack.active = sourceStack.panels[0];
  if (!sourceStack.panels.length) {
    next.rows[source.rowIndex].columns.splice(source.stackIndex, 1);
    if (!next.rows[source.rowIndex].columns.length) next.rows.splice(source.rowIndex, 1);
    else next.rows[source.rowIndex].columns = normalizeWidths(next.rows[source.rowIndex].columns);
  }

  const target = locateStack(next, targetStackId);
  if (!target) return layout;
  const targetRow = next.rows[target.rowIndex];
  const targetStack = targetRow.columns[target.stackIndex];

  if (placement === "center") {
    targetStack.panels.push(panel);
    targetStack.active = panel;
    return next;
  }

  const stack: DockStack = {
    id: uniqueId(`stack-${panel}`, next),
    width: 1,
    panels: [panel],
    active: panel,
  };

  if (placement === "left" || placement === "right") {
    stack.width = targetStack.width / 2;
    targetStack.width /= 2;
    targetRow.columns.splice(target.stackIndex + (placement === "right" ? 1 : 0), 0, stack);
    targetRow.columns = normalizeWidths(targetRow.columns);
    return next;
  }

  const row: DockRow = {
    id: uniqueId(`row-${panel}`, next),
    height: Math.min(910, Math.max(320, targetRow.height)),
    columns: [stack],
  };
  next.rows.splice(target.rowIndex + (placement === "bottom" ? 1 : 0), 0, row);
  return next;
}

export function resizeDockRow(layout: DockLayoutState, rowId: string, height: number): DockLayoutState {
  const next = cloneLayout(layout);
  const row = next.rows.find((item) => item.id === rowId);
  if (!row) return layout;
  row.height = Math.min(1400, Math.max(220, height));
  return next;
}

export function resizeDockColumns(
  layout: DockLayoutState,
  rowId: string,
  dividerIndex: number,
  delta: number,
): DockLayoutState {
  const next = cloneLayout(layout);
  const row = next.rows.find((item) => item.id === rowId);
  if (!row || dividerIndex < 0 || dividerIndex >= row.columns.length - 1) return layout;
  const left = row.columns[dividerIndex];
  const right = row.columns[dividerIndex + 1];
  const total = left.width + right.width;
  const minimum = Math.min(0.16, total * 0.4);
  const nextLeft = Math.max(minimum, Math.min(total - minimum, left.width + delta));
  left.width = nextLeft;
  right.width = total - nextLeft;
  return next;
}
