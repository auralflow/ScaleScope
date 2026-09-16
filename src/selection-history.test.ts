import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { commitSelection, createSelectionHistory, redoSelection, undoSelection } from "./selection-history.ts";

const notes = (selection: ReadonlySet<number>) => [...selection].sort((a, b) => a - b);

describe("note selection history", () => {
  it("undoes and redoes committed selections", () => {
    let history = createSelectionHistory();
    history = commitSelection(history, [0, 4, 7]);
    history = commitSelection(history, [0, 2, 4, 5, 7, 9, 11]);
    history = undoSelection(history);
    assert.deepEqual(notes(history.present), [0, 4, 7]);
    history = redoSelection(history);
    assert.deepEqual(notes(history.present), [0, 2, 4, 5, 7, 9, 11]);
  });

  it("clears redo history after a new change", () => {
    let history = commitSelection(createSelectionHistory(), [0]);
    history = commitSelection(history, [0, 4]);
    history = undoSelection(history);
    history = commitSelection(history, [0, 7]);
    assert.equal(history.future.length, 0);
    assert.strictEqual(redoSelection(history), history);
  });

  it("does not record an unchanged selection", () => {
    const history = commitSelection(createSelectionHistory([0, 4, 7]), [7, 4, 0]);
    assert.equal(history.past.length, 0);
  });
});
