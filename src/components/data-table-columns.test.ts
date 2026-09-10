import { describe, it, expect } from "vitest";
import { visibleMobileColumns, type DataTableColumn } from "./data-table";

type Row = { id: string; email: string };

const columns: DataTableColumn<Row>[] = [
  { key: "email", header: "Email", cell: (r) => r.email },
  { key: "created", header: "Created", cell: () => "", hideOnMobile: true },
];

describe("visibleMobileColumns", () => {
  it("excludes columns marked hideOnMobile", () => {
    expect(visibleMobileColumns(columns).map((c) => c.key)).toEqual(["email"]);
  });

  it("keeps all columns when none are hidden", () => {
    const noHidden: DataTableColumn<Row>[] = [columns[0]];
    expect(visibleMobileColumns(noHidden)).toHaveLength(1);
  });
});
