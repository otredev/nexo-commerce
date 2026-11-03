/**
 * Ayuda: the user manual (docs/manual-de-usuario.md) inside the dashboard, with a table of contents,
 * search and links from each page ("?" in the top bar). The same Markdown and screenshots as the repository,
 * bundled at build time, so the help never drifts from the docs.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { marked } from "marked";
import { BookOpen, X } from "lucide-react";
import { PageHeader, SearchInput } from "@nexo/ui";
import manual from "../../../../docs/manual-de-usuario.md?raw";

const images = import.meta.glob("../../../../docs/img/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const imageUrl = (name: string) => images[`../../../../docs/img/${name}`] ?? "";

/** GitHub-style heading ids, so the manual's own links (#3-productos-y-catálogo) work here too. */
export const slugify = (text: string) =>
  text.trim().toLowerCase().replace(/<[^>]+>/g, "").replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

interface Section { id: string; title: string; sub: Array<{ id: string; title: string }>; markdown: string; text: string }

/** The manual split by "## " headings (the intro and the manual's own table of contents are dropped). */
function sections(source: string): Section[] {
  const md = source.replace(/\]\(img\/([\w-]+\.png)\)/g, (_m, f: string) => `](${imageUrl(f)})`).replace(/src="img\/([\w-]+\.png)"/g, (_m, f: string) => `src="${imageUrl(f)}"`);
  const parts = md.split(/^## /m).slice(1);
  return parts
    .map((part) => {
      const [first, ...rest] = part.split("\n");
      const title = first!.trim();
      const body = rest.join("\n").replace(/\n---\s*$/, "");
      const sub = [...body.matchAll(/^### (.+)$/gm)].map((m) => ({ id: slugify(m[1]!), title: m[1]!.trim() }));
      return { id: slugify(title), title, sub, markdown: `## ${title}\n${body}`, text: fold(`${title}\n${body}`) };
    })
    .filter((s) => s.id !== "contenido");
}

const renderer = new marked.Renderer();
renderer.heading = ({ tokens, depth, text }) => {
  const id = slugify(text);
  return `<h${depth} id="${id}"><a class="nx-doc__anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${marked.Parser.parseInline(tokens)}</h${depth}>`;
};
renderer.link = ({ href, title, tokens }) => {
  const label = marked.Parser.parseInline(tokens);
  const external = /^https?:\/\//.test(href);
  return `<a href="${href}"${title ? ` title="${title}"` : ""}${external ? ' target="_blank" rel="noreferrer"' : ""}>${label}</a>`;
};
renderer.image = ({ href, text }) => `<figure><img src="${href}" alt="${text}" loading="lazy" /><figcaption>${text}</figcaption></figure>`;
renderer.table = function (token) {
  return `<div class="nx-doc__table">${marked.Renderer.prototype.table.call(this, token)}</div>`;
};

const html = (md: string) => marked.parse(md, { renderer, gfm: true, async: false }) as string;

export function HelpPage() {
  const all = useMemo(() => sections(manual), []);
  const location = useLocation();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(all[0]?.id ?? "");
  const content = useRef<HTMLDivElement>(null);
  const terms = fold(q).split(/\s+/).filter(Boolean);
  const shown = terms.length ? all.filter((s) => terms.every((t) => s.text.includes(t))) : all;
  const rendered = useMemo(() => shown.map((s) => ({ id: s.id, html: html(s.markdown) })), [shown.map((s) => s.id).join()]);

  useEffect(() => { document.title = "Ayuda · Nexo"; }, []);
  // A new search shows its results from the top.
  useEffect(() => { if (q) window.scrollTo({ top: 0 }); }, [q]);

  // Scroll to the section in the address (#…), also when it changes from a link inside the manual.
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id) return;
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
  }, [location.hash, rendered.length]);

  // Highlights the section being read in the table of contents.
  useEffect(() => {
    const root = content.current;
    if (!root) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: "-80px 0px -70% 0px" },
    );
    root.querySelectorAll("h2[id]").forEach((h) => obs.observe(h));
    return () => obs.disconnect();
  }, [rendered]);

  return (
    <>
      <PageHeader title="Ayuda" description="Cómo usar Nexo, paso a paso. Busca un tema o elige una sección." />
      <div className="nx-help-layout">
        <aside className="nx-help-toc" aria-label="Secciones de la ayuda">
          <SearchInput value={q} onChange={setQ} placeholder="Buscar en la ayuda" label="Buscar en la ayuda" width={260} />
          {terms.length > 0 && (
            <p className="nx-muted" style={{ fontSize: 12, margin: "8px 2px 0" }}>
              {shown.length ? `${shown.length} ${shown.length === 1 ? "sección" : "secciones"} con «${q.trim()}»` : `Nada sobre «${q.trim()}».`}
            </p>
          )}
          <nav>
            <ol>
              {shown.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} aria-current={active === s.id ? "true" : undefined}>{s.title.replace(/^\d+\.\s*/, "")}</a>
                  {active === s.id && s.sub.length > 0 && (
                    <ol>{s.sub.map((x) => <li key={x.id}><a href={`#${x.id}`}>{x.title}</a></li>)}</ol>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        </aside>
        <div ref={content} className="nx-doc">
          {terms.length > 0 && (
            <div className="nx-doc__filter">
              Mostrando solo lo que menciona «{q.trim()}».
              <button type="button" className="nx-link" onClick={() => setQ("")}><X className="nx-icon" aria-hidden="true" />Ver todo</button>
            </div>
          )}
          {rendered.length === 0 ? (
            <div className="nx-doc__empty">
              <BookOpen className="nx-icon" aria-hidden="true" />
              <p>No encontramos ese tema. Prueba con otra palabra, por ejemplo «caja», «inventario» o «pedido».</p>
            </div>
          ) : (
            rendered.map((s) => <section key={s.id} dangerouslySetInnerHTML={{ __html: s.html }} />)
          )}
          <p className="nx-help" style={{ marginTop: 48 }}>¿No encontraste lo que buscabas? Presiona <kbd>Ctrl</kbd> + <kbd>K</kbd> para ir a cualquier página, o vuelve al <Link className="nx-link" to="/">inicio</Link>.</p>
        </div>
      </div>
    </>
  );
}
