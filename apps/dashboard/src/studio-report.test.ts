import { describe, expect, it } from "vitest";
import { getUnfilteredTotal, setUnfilteredTotal } from "./studio-filters";
import { initialState } from "./studio-report";

type Widget = { type: string; format?: { title?: { text?: string; enabled?: boolean } } };

describe("the Studio report (#125)", () => {
  const pages = initialState.pages as unknown as {
    id: string;
    widgets: Record<string, Widget>;
    widgetLayout: Record<string, unknown>;
    filter?: {
      widget?: Record<string, { field: { id: string }; model: { operator: string; value: string } }[]>;
    };
  }[];

  it("has the dashboard page and a queues page, and opens on the dashboard", () => {
    expect(pages.map((p) => p.id)).toEqual(["disputes", "queues"]);
    expect(initialState.selectedPageId).toBe("disputes");
  });

  it("enables every widget's title: Studio draws a custom widget's title itself, and only when it is enabled", () => {
    for (const page of pages) {
      for (const [id, widget] of Object.entries(page.widgets)) {
        expect(widget.format?.title?.text, `${page.id}/${id} has a title`).toBeTruthy();
        expect(widget.format?.title?.enabled, `${page.id}/${id} title is enabled`).toBe(true);
      }
    }
  });

  it("places every widget on its page, and nothing else", () => {
    for (const page of pages) {
      expect(Object.keys(page.widgetLayout).sort()).toEqual(Object.keys(page.widgets).sort());
    }
  });

  it("splits the queues by decision with a filter on each grid alone", () => {
    const queues = pages.find((p) => p.id === "queues")!;
    expect(queues.widgets.defendQueue!.type).toBe("dispute-grid");
    expect(queues.widgets.concedeQueue!.type).toBe("dispute-grid");
    expect(queues.filter?.widget).toEqual({
      defendQueue: [{ field: { id: "disputes.decision" }, model: { operator: "equals", value: "defend" } }],
      concedeQueue: [{ field: { id: "disputes.decision" }, model: { operator: "equals", value: "concede" } }],
    });
    expect(queues.filter).not.toHaveProperty("page"); // the page's other widgets are not narrowed
  });

  it("remembers how many disputes there are before any filter", () => {
    setUnfilteredTotal(24);
    expect(getUnfilteredTotal()).toBe(24);
  });
});
