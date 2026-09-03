import { describe, expect, it } from "vitest";

import {
  parseTaskDocument,
  syncTaskDocuments,
} from "../../scripts/sync-task-files.mjs";

describe("task file synchronization", () => {
  it("moves a completed top-level task together with its children", () => {
    const result = syncTaskDocuments(
      `# Foodfolio TODO

- [x] 完了した親
  - [ ] 未完了の子
  - 補足
- [ ] 未完了の親
  - [x] 完了した子
`,
      "",
    );

    expect(result.todo).toBe(`# Foodfolio TODO

- [ ] 未完了の親
  - [x] 完了した子
`);
    expect(result.completed).toBe(`# Foodfolio 完了済みタスク

- [x] 完了した親
  - [ ] 未完了の子
  - 補足
`);
  });

  it("keeps commented-out checkboxes in todo", () => {
    const result = syncTaskDocuments(
      `# Foodfolio TODO

- [x] 完了

<!-- - [ ] 保留中 -->

- [ ] 未完了
`,
      "",
    );

    expect(result.todo).toContain("<!-- - [ ] 保留中 -->");
    expect(result.completed).not.toContain("保留中");
  });

  it("appends newly completed tasks and restores unchecked completed tasks", () => {
    const result = syncTaskDocuments(
      `# Foodfolio TODO

- [ ] 継続中
- [x] 新しく完了
`,
      `# Foodfolio 完了済みタスク

- [x] 以前に完了
- [ ] 再開したタスク
`,
    );

    expect(result.todo).toBe(`# Foodfolio TODO

- [ ] 再開したタスク
- [ ] 継続中
`);
    expect(result.completed).toBe(`# Foodfolio 完了済みタスク

- [x] 以前に完了
- [x] 新しく完了
`);
  });

  it("is idempotent after classification", () => {
    const first = syncTaskDocuments(
      "# Foodfolio TODO\n\n- [ ] 未完了\n- [x] 完了\n",
      "",
    );
    const second = syncTaskDocuments(first.todo, first.completed);

    expect(second).toEqual(first);
  });

  it("recognizes only top-level checkboxes as task boundaries", () => {
    const segments = parseTaskDocument(`# Title

- [ ] 親
  - [x] 子
`);

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ kind: "task", completed: false });
  });
});
