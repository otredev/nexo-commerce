import { Fragment } from "react";
import { isList, parseMarkdown, type Inline } from "@nexo/shared";

const inline = (c: Inline[]) =>
  c.map((i, n) =>
    i.t === "text" ? <Fragment key={n}>{i.v}</Fragment> : i.t === "bold" ? <strong key={n}>{i.v}</strong> : <a key={n} className="nx-link" href={i.href} target="_blank" rel="noreferrer">{i.v}</a>,
  );

/** Renders the policies' Markdown subset as React (never as raw HTML). */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="nx-md">
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
