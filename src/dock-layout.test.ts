import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DOCK_LAYOUT,
  PANEL_IDS,
  movePanel,
  normalizeDockLayout,
  resizeDockColumns,
  resizeDockRow,
} from "./dock-layout.ts";

function allPanels(layout = DEFAULT_DOCK_LAYOUT) {
  return layout.rows.flatMap((row) => row.columns.flatMap((stack) => stack.panels));
}

test("default dock layout contains every workspace panel once", () => {
  assert.deepEqual([...allPanels()].sort(), [...PANEL_IDS].sort());
});

test("panels can merge into tabs without duplication", () => {
  const next = movePanel(DEFAULT_DOCK_LAYOUT, "guitar", "stack-keyboard", "center");
  const stack = next.rows.flatMap((row) => row.columns).find((item) => item.id === "stack-keyboard");
  assert.deepEqual(stack?.panels, ["keyboard", "guitar"]);
  assert.equal(stack?.active, "guitar");
  assert.deepEqual([...allPanels(next)].sort(), [...PANEL_IDS].sort());
});

test("panels can dock beside or below another panel", () => {
  const beside = movePanel(DEFAULT_DOCK_LAYOUT, "guitar", "stack-keyboard", "right");
  assert.equal(beside.rows[0].columns.length, 2);
  assert.equal(beside.rows.some((row) => row.id === "row-guitar"), false);

  const below = movePanel(DEFAULT_DOCK_LAYOUT, "camelot", "stack-keyboard", "bottom");
  assert.equal(below.rows[1].columns[0].active, "camelot");
  assert.deepEqual([...allPanels(below)].sort(), [...PANEL_IDS].sort());
});

test("dock dimensions stay within usable limits", () => {
  assert.equal(resizeDockRow(DEFAULT_DOCK_LAYOUT, "row-keyboard", 20).rows[0].height, 220);
  const resized = resizeDockColumns(DEFAULT_DOCK_LAYOUT, "row-harmony", 0, -0.9);
  const harmony = resized.rows.find((row) => row.id === "row-harmony")!;
  assert.ok(harmony.columns[0].width >= 0.16);
  assert.ok(Math.abs(harmony.columns.reduce((sum, column) => sum + column.width, 0) - 1) < 0.0001);
});

test("invalid saved layouts fall back to the complete default", () => {
  const restored = normalizeDockLayout({ version: 1, rows: [] });
  assert.deepEqual([...allPanels(restored)].sort(), [...PANEL_IDS].sort());
});
