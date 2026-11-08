/** The permission catalog as checkboxes, grouped. Used by the role editor of the business panel. */
import { PERMISSION_GROUPS, type Permission } from "@nexo/shared";

export function PermissionChecklist({ value, onChange, allowed, readOnly }: {
  value: readonly Permission[];
  onChange?: (next: Permission[]) => void;
  /** Permissions this person may give (the rest show disabled). Omit to allow all. */
  allowed?: readonly Permission[];
  readOnly?: boolean;
}) {
  const set = new Set(value);
  const may = (p: Permission) => !readOnly && (!allowed || allowed.includes(p));
  const toggle = (p: Permission, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(p); else next.delete(p);
    onChange?.([...next]);
  };
  return (
    <div className="nx-perms">
      {PERMISSION_GROUPS.map((g) => {
        const editable = g.items.filter((i) => may(i.id));
        const all = editable.length > 0 && editable.every((i) => set.has(i.id));
        const some = g.items.filter((i) => set.has(i.id)).length;
        return (
          <fieldset key={g.id} className="nx-perms__group">
            <legend className="nx-perms__legend">
              <span>{g.label}</span>
              <span className="nx-muted nx-num" style={{ fontWeight: 400 }}>{some}/{g.items.length}</span>
              {!readOnly && editable.length > 0 && (
                <button
                  type="button"
                  className="nx-link nx-perms__all"
                  onClick={() => {
                    const next = new Set(set);
                    editable.forEach((i) => (all ? next.delete(i.id) : next.add(i.id)));
                    onChange?.([...next]);
                  }}
                >
                  {all ? "Quitar todos" : "Marcar todos"}
                </button>
              )}
            </legend>
            {g.items.map((i) => (
              <label key={i.id} className="nx-perms__item" data-off={!may(i.id) || undefined}>
                <input type="checkbox" checked={set.has(i.id)} disabled={!may(i.id)} onChange={(e) => toggle(i.id, e.target.checked)} />
                <span>
                  {i.label}
                  {i.help && <span className="nx-help" style={{ display: "block", margin: 0 }}>{i.help}</span>}
                </span>
              </label>
            ))}
          </fieldset>
        );
      })}
    </div>
  );
}
