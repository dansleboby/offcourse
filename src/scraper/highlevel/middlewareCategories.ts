import type { HighLevelCourseStructure } from "./navigator.js";

interface MiddlewarePost {
  id: string;
  title: string;
  sequenceNo?: number | null;
  visibility?: string | null;
  lockedByPost?: string | null;
  lockedByCategory?: string | null;
}
interface MiddlewareCategory {
  id: string;
  title: string;
  sequenceNo?: number | null;
  parentCategory?: string | null;
  visibility?: string | null;
  lockedBy?: string | null;
  lockedByCategory?: string | null;
  posts?: MiddlewarePost[];
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Parse the clientportal-middleware categories payload without exposing user metadata. */
export function parseMiddlewareCategories(
  data: unknown
): HighLevelCourseStructure["categories"] | null {
  if (!record(data) || !Array.isArray(data.categories)) return null;
  const entries: MiddlewareCategory[] = [];
  for (const entry of data.categories) {
    if (!record(entry) || typeof entry.id !== "string" || typeof entry.title !== "string") {
      return null;
    }
    const posts: MiddlewarePost[] = [];
    if (entry.posts !== undefined && !Array.isArray(entry.posts)) return null;
    for (const post of (entry.posts as unknown[] | undefined) ?? []) {
      if (!record(post) || typeof post.id !== "string" || typeof post.title !== "string") {
        return null;
      }
      posts.push(post as unknown as MiddlewarePost);
    }
    entries.push({ ...(entry as unknown as MiddlewareCategory), posts });
  }

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const order = (a: { sequenceNo?: number | null }, b: { sequenceNo?: number | null }) =>
    (a.sequenceNo ?? 0) - (b.sequenceNo ?? 0);

  // Preserve nested categories in the flat structure Offcourse currently stores.
  // Prefix section titles to prevent collisions between similarly named sections.
  function label(category: MiddlewareCategory): string {
    const ancestors = new Set([category.id]);
    const names = [category.title];
    let parentId = category.parentCategory;
    while (parentId && byId.has(parentId) && !ancestors.has(parentId)) {
      ancestors.add(parentId);
      const parent = byId.get(parentId)!;
      names.unshift(parent.title);
      parentId = parent.parentCategory;
    }
    return names.join(" / ");
  }
  const roots = entries.filter((cat) => !cat.parentCategory || !byId.has(cat.parentCategory));
  const sorted: MiddlewareCategory[] = [];
  const visited = new Set<string>();
  function visit(category: MiddlewareCategory): void {
    if (visited.has(category.id)) return;
    visited.add(category.id);
    sorted.push(category);
    entries.filter((cat) => cat.parentCategory === category.id).sort(order).forEach(visit);
  }
  roots.sort(order).forEach(visit);
  entries.sort(order).forEach(visit);

  return sorted.map((cat, index) => ({
    id: cat.id,
    title: label(cat),
    description: null,
    position: index,
    postCount: cat.posts?.length ?? 0,
    isLocked: cat.visibility === "locked" || !!cat.lockedBy,
    posts: (cat.posts ?? []).slice().sort(order).map((post, postIndex) => ({
      id: post.id,
      title: post.title,
      categoryId: cat.id,
      position: post.sequenceNo ?? postIndex,
      isLocked: post.visibility === "locked" || !!post.lockedByPost || !!post.lockedByCategory,
      isCompleted: false,
    })),
  }));
}
