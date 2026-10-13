import { describe, expect, it } from "vitest";
import { parseMiddlewareCategories } from "./middlewareCategories.js";

describe("parseMiddlewareCategories", () => {
  it("sorts parent/child categories and uses the embedded post identifiers", () => {
    const parsed = parseMiddlewareCategories({ categories: [
      { id: "child", title: "Section 1", parentCategory: "parent", sequenceNo: 0, posts: [
        { id: "p2", title: "Second", sequenceNo: 1, visibility: "published" },
        { id: "p1", title: "First", sequenceNo: 0, visibility: "published" },
      ] },
      { id: "parent", title: "Day 1", parentCategory: null, sequenceNo: 0, posts: [] },
      { id: "intro", title: "Introduction", parentCategory: null, sequenceNo: -1, posts: [
        { id: "welcome", title: "Welcome", sequenceNo: 0 },
      ] },
    ] });
    expect(parsed?.map((category) => category.title)).toEqual([
      "Introduction", "Day 1", "Day 1 / Section 1",
    ]);
    expect(parsed?.[2].posts.map((post) => post.id)).toEqual(["p1", "p2"]);
    expect(parsed?.[2].posts[0]?.categoryId).toBe("child");
    expect(parsed?.[2].parentCategoryId).toBe("parent");
    expect(parsed?.[0].parentCategoryId).toBeNull();
  });

  it("rejects a malformed catalog rather than treating it as an empty course", () => {
    expect(parseMiddlewareCategories({ categories: [{ id: 123 }] })).toBeNull();
    expect(parseMiddlewareCategories({ noCategories: [] })).toBeNull();
  });

  it("preserves empty parent categories", () => {
    const parsed = parseMiddlewareCategories({ categories: [
      { id: "parent", title: "Day 1", posts: [], sequenceNo: 0 },
    ] });
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0].posts).toEqual([]);
  });
});
