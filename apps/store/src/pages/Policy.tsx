import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { POLICY_INFO, type PolicyKind } from "@nexo/shared";
import { api, RequestError } from "../lib/api";
import { useStore } from "../lib/store";
import { Markdown } from "../components/Markdown";

const dateFmt = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", year: "numeric" });

export function PolicyPage({ kind }: { kind: PolicyKind }) {
  const { slug, link, store } = useStore();
  const [page, setPage] = useState<{ content: string; updatedAt: string } | null>(null);
  const [error, setError] = useState<RequestError | null>(null);
  const info = POLICY_INFO[kind];
  useEffect(() => {
    setPage(null);
    setError(null);
    api<{ content: string; updatedAt: string }>("GET", `/${slug}/policies/${kind}`).then(setPage, (e: RequestError) => setError(e));
  }, [slug, kind]);
  useEffect(() => {
    if (store) document.title = `${info.title} · ${store.name}`;
  }, [store, info.title]);

  if (error) {
    return (
      <div className="st-wrap st-empty">
        <h1 className="st-empty__title">Esta página no existe</h1>
        <Link className="nx-btn nx-btn--secondary" to={link()}>Ir a la tienda</Link>
      </div>
    );
  }
  return (
    <div className="st-wrap">
      <article className="st-policy">
        <h1 className="st-page-title">{info.title}</h1>
        {page ? (
          <>
            <Markdown text={page.content} />
            <p className="st-policy__date">Última actualización: {dateFmt.format(new Date(page.updatedAt))}</p>
          </>
        ) : (
          <div className="nx-page-loading" style={{ minHeight: "30vh" }}><span className="nx-spinner" aria-label="Cargando" /></div>
        )}
      </article>
    </div>
  );
}
