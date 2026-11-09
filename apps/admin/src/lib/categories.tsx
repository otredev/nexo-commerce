import type { CategoryItem } from "@nexo/shared";

export interface CategoryNode extends CategoryItem {
  children: CategoryItem[];
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "es", { sensitivity: "base" });

/** Main categories with their subcategories, both sorted by name. */
export function categoryTree(list: readonly CategoryItem[]): CategoryNode[] {
  const ids = new Set(list.map((c) => c.id));
  return list
    .filter((c) => !c.parentId || !ids.has(c.parentId))
    .sort(byName)
    .map((c) => ({ ...c, children: list.filter((x) => x.parentId === c.id).sort(byName) }));
}

/** "Ropa › Camisas" for a subcategory, the name for a main category. */
export function categoryLabel(list: readonly CategoryItem[], id: string | null | undefined): string | null {
  const c = list.find((x) => x.id === id);
  if (!c) return null;
  const parent = c.parentId ? list.find((x) => x.id === c.parentId) : undefined;
  return parent ? `${parent.name} › ${c.name}` : c.name;
}

/** <option>s for a category select: each main category followed by its subcategories ("Ropa › Camisas"). */
export function CategoryOptions({ list }: { list: readonly CategoryItem[] }) {
  return (
    <>
      {categoryTree(list).map((c) => [
        <option key={c.id} value={c.id}>{c.name}</option>,
        ...c.children.map((s) => <option key={s.id} value={s.id}>{`${c.name} › ${s.name}`}</option>),
      ])}
    </>
  );
}
