import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Tags } from "lucide-react";
import type { Named } from "@nexo/shared";
import { Alert, Button, EmptyState, Modal, PageHeader, TextField, useToast } from "@nexo/ui";
import { del, get, post, put } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLoad, useSubmit } from "../lib/hooks";

export function CatalogNamesPage() {
  return (
    <>
      <PageHeader title="Categorías y marcas" description="Organiza tu catálogo para encontrar y filtrar productos más rápido." />
      <div className="nx-grid-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        <NamedList kind="category" />
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
