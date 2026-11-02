import { Fragment } from "react";
import { Link } from "react-router-dom";
import { isList, parseMarkdown, type Inline } from "@nexo/shared";
import { useStore } from "../lib/store";

/** The store's legal pages: a small Markdown subset rendered as React (never as raw HTML). */
export function Markdown({ text }: { text: string }) {
  const { link } = useStore();
  const inline = (c: Inline[]) =>
    c.map((i, n) => {
      if (i.t === "text") return <Fragment key={n}>{i.v}</Fragment>;
      if (i.t === "bold") return <strong key={n}>{i.v}</strong>;
      // "/terminos" in a policy means this store's page, wherever the store lives.
      if (i.href.startsWith("/")) return <Link key={n} to={link(i.href)}>{i.v}</Link>;
      return <a key={n} href={i.href} target={i.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">{i.v}</a>;
    });
  return (
    <div className="st-md">
      {parseMarkdown(text).map((b, n) => {
        if (isList(b)) {
          const L = b.t;
          return <L key={n}>{b.items.map((it, k) => <li key={k}>{inline(it)}</li>)}</L>;
        }
        const T = b.t;
        return <T key={n}>{inline(b.c)}</T>;
      })}
    </div>
  );
}
