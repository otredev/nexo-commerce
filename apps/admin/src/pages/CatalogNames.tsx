import { useState } from "react";
import { Link } from "react-router-dom";
import { CornerDownRight, Plus, Tags } from "lucide-react";
import type { CategoryItem, Named } from "@nexo/shared";
import { Alert, Button, EmptyState, Modal, PageHeader, SelectField, TextField, useToast } from "@nexo/ui";
import { categoryTree } from "../lib/categories";
import { del, get, post, put } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLoad, useSubmit } from "../lib/hooks";

export function CatalogNamesPage() {
  return (
    <>
      <PageHeader title="Categorías y marcas" description="Organiza tu catálogo para encontrar y filtrar productos más rápido. Cada categoría puede tener subcategorías." />
      <div className="nx-grid-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        <CategoryList />
        <NamedList kind="brand" />
      </div>
    </>
  );
}

function NamedList({ kind }: { kind: "category" | "brand" }) {
  const { can } = useAuth();
  const toast = useToast();
  const path = kind === "category" ? "/categories" : "/brands";
  const singular = kind === "category" ? "categoría" : "marca";
  const plural = kind === "category" ? "Categorías" : "Marcas";
  const filterParam = kind === "category" ? "categoria" : "marca";
  const { data, error, reload } = useLoad(() => get<Named[]>(path));
  const [editing, setEditing] = useState<Named | "new" | null>(null);
  const [removing, setRemoving] = useState<Named | null>(null);
  const [name, setName] = useState("");
  const editable = can("catalog:write");

  const save = useSubmit(async () => {
    if (editing === "new") await post(path, { name });
    else if (editing) await put(`${path}/${editing.id}`, { name });
    toast(editing === "new" ? `${singular[0]!.toUpperCase()}${singular.slice(1)} creada` : "Cambios guardados");
    setEditing(null);
    await reload();
  });
  const remove = useSubmit(async () => {
    if (!removing) return;
    await del(`${path}/${removing.id}`);
    toast(`${removing.name} eliminada`);
    setRemoving(null);
    await reload();
  });
  const open = (item: Named | "new") => { setEditing(item); setName(item === "new" ? "" : item.name); };

  return (
    <div className="nx-table-wrap">
      <div className="nx-table-toolbar">
        <span style={{ fontWeight: 600 }}>{plural}</span>
        {editable && <Button size="sm" variant="primary" onClick={() => open("new")}><Plus className="nx-icon" aria-hidden="true" />Nueva {singular}</Button>}
      </div>
      {error && <div style={{ padding: 16 }}><Alert tone="danger">{error.message}</Alert></div>}
      {data && data.length === 0 ? (
        <EmptyState icon={<Tags className="nx-icon" />} title={`Sin ${plural.toLowerCase()}`} text={kind === "category" ? "Por ejemplo: Ropa, Hogar, Bebidas." : "Las marcas de los productos que vendes."} />
      ) : (
        <table className="nx-table">
          <thead><tr><th>Nombre</th><th className="nx-col-num">Productos</th><th aria-label="Acciones" /></tr></thead>
          <tbody>
            {data?.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td className="nx-col-num">{item.productCount > 0 ? <Link className="nx-link" to={`/productos?${filterParam}=${item.id}`}>{item.productCount}</Link> : <span className="nx-muted">0</span>}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {editable && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => open(item)}>Renombrar</Button>
                      <Button size="sm" variant="danger-ghost" onClick={() => setRemoving(item)}>Eliminar</Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Modal
        open={editing !== null}
        title={editing === "new" ? `Nueva ${singular}` : `Renombrar ${singular}`}
        onClose={() => setEditing(null)}
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button><Button variant="primary" loading={save.pending} onClick={() => void save.submit()}>Guardar</Button></>}
      >
        <form onSubmit={(e) => { e.preventDefault(); void save.submit(); }}>
          <TextField label="Nombre" value={name} onChange={(e) => setName(e.target.value)} error={save.fields.name ?? save.message ?? undefined} />
        </form>
      </Modal>
      <Modal
        open={removing !== null}
        title={`¿Eliminar ${removing?.name ?? ""}?`}
        onClose={() => setRemoving(null)}
        footer={<><Button variant="ghost" onClick={() => setRemoving(null)}>Cancelar</Button><Button variant="danger" loading={remove.pending} onClick={() => void remove.submit()}>Eliminar</Button></>}
      >
        {removing && removing.productCount > 0
          ? `Sus ${removing.productCount} productos quedarán sin ${singular}. Los productos no se eliminan.`
          : `La ${singular} no tiene productos.`}
      </Modal>
    </div>
  );
}

/** Categories with one level of subcategories. */
function CategoryList() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useLoad(() => get<CategoryItem[]>("/categories"));
  const [editing, setEditing] = useState<CategoryItem | { parentId: string | null } | null>(null);
  const [removing, setRemoving] = useState<CategoryItem | null>(null);
  const [form, setForm] = useState({ name: "", parentId: "" });
  const editable = can("catalog:write");
  const tree = categoryTree(data ?? []);
  const isNew = editing !== null && !("id" in editing);
  const current = editing && "id" in editing ? editing : null;
  const hasChildren = Boolean(current && data?.some((c) => c.parentId === current.id));

  const save = useSubmit(async () => {
    const body = { name: form.name, parentId: form.parentId || null };
    if (current) await put(`/categories/${current.id}`, body);
    else await post("/categories", body);
    toast(current ? "Cambios guardados" : body.parentId ? "Subcategoría creada" : "Categoría creada");
    setEditing(null);
    await reload();
  });
  const remove = useSubmit(async () => {
    if (!removing) return;
    await del(`/categories/${removing.id}`);
    toast(`${removing.name} eliminada`);
    setRemoving(null);
    await reload();
  });
  const open = (item: CategoryItem | { parentId: string | null }) => {
    setEditing(item);
    setForm({ name: "id" in item ? item.name : "", parentId: item.parentId ?? "" });
  };
  const row = (item: CategoryItem, sub: boolean) => (
    <tr key={item.id} className={sub ? "nx-cat-sub" : undefined}>
      <td>
        {sub ? (
          <span className="nx-row" style={{ gap: 6, alignItems: "center", paddingLeft: 8 }}>
            <CornerDownRight className="nx-icon nx-muted" aria-hidden="true" style={{ width: 14, height: 14 }} />
            {item.name}
          </span>
        ) : <span style={{ fontWeight: 600 }}>{item.name}</span>}
      </td>
      <td className="nx-col-num">{item.productCount > 0 ? <Link className="nx-link" to={`/productos?categoria=${item.id}`}>{item.productCount}</Link> : <span className="nx-muted">0</span>}</td>
      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        {editable && (
          <>
            {!sub && <Button size="sm" variant="ghost" onClick={() => open({ parentId: item.id })}><Plus className="nx-icon" aria-hidden="true" />Subcategoría</Button>}
            <Button size="sm" variant="ghost" onClick={() => open(item)}>Editar</Button>
            <Button size="sm" variant="danger-ghost" onClick={() => setRemoving(item)}>Eliminar</Button>
          </>
        )}
      </td>
    </tr>
  );
  const removingKids = removing ? (data ?? []).filter((c) => c.parentId === removing.id).length : 0;

  return (
    <div className="nx-table-wrap">
      <div className="nx-table-toolbar">
        <span style={{ fontWeight: 600 }}>Categorías</span>
        {editable && <Button size="sm" variant="primary" onClick={() => open({ parentId: null })}><Plus className="nx-icon" aria-hidden="true" />Nueva categoría</Button>}
      </div>
      {error && <div style={{ padding: 16 }}><Alert tone="danger">{error.message}</Alert></div>}
      {data && data.length === 0 ? (
        <EmptyState icon={<Tags className="nx-icon" />} title="Sin categorías" text="Por ejemplo: Ropa, con las subcategorías Camisas y Pantalones." />
      ) : (
        <table className="nx-table">
          <thead><tr><th>Nombre</th><th className="nx-col-num">Productos</th><th aria-label="Acciones" /></tr></thead>
          <tbody>{tree.flatMap((c) => [row(c, false), ...c.children.map((s) => row(s, true))])}</tbody>
        </table>
      )}
      <Modal
        open={editing !== null}
        title={current ? `Editar ${current.name}` : form.parentId ? "Nueva subcategoría" : "Nueva categoría"}
        onClose={() => setEditing(null)}
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button><Button variant="primary" type="submit" form="category-form" loading={save.pending}>Guardar</Button></>}
      >
        <form id="category-form" className="nx-stack" onSubmit={(e) => { e.preventDefault(); void save.submit(); }} noValidate>
          {save.message && !save.fields.name && !save.fields.parentId && <Alert tone="danger">{save.message}</Alert>}
          <TextField label="Nombre" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={save.fields.name} />
          <SelectField
            label="Dentro de"
            value={form.parentId}
            onChange={(e) => setForm({ ...form, parentId: e.target.value })}
            disabled={hasChildren}
            error={save.fields.parentId}
            help={hasChildren ? "Tiene subcategorías, así que es una categoría principal." : isNew && !form.parentId ? "Déjalo así para una categoría principal, o elige una para crear una subcategoría." : undefined}
          >
            <option value="">Ninguna (categoría principal)</option>
            {tree.filter((c) => c.id !== current?.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </SelectField>
        </form>
      </Modal>
      <Modal
        open={removing !== null}
        title={`¿Eliminar ${removing?.name ?? ""}?`}
        onClose={() => setRemoving(null)}
        footer={<><Button variant="ghost" onClick={() => setRemoving(null)}>Cancelar</Button><Button variant="danger" loading={remove.pending} disabled={removingKids > 0} onClick={() => void remove.submit()}>Eliminar</Button></>}
      >
        {remove.message && <Alert tone="danger">{remove.message}</Alert>}
        {removingKids > 0
          ? `Tiene ${removingKids === 1 ? "una subcategoría" : `${removingKids} subcategorías`}. Elimínalas o muévelas a otra categoría primero.`
          : removing && removing.productCount > 0
            ? `Sus ${removing.productCount} productos quedarán sin categoría. Los productos no se eliminan.`
            : "La categoría no tiene productos."}
      </Modal>
    </div>
  );
}
