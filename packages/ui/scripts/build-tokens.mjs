// Compiles tokens.json (the design system's source of truth) into styles/tokens.css.
// Run after editing tokens.json: npm run build -w @nexo/ui
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const t = JSON.parse(readFileSync(new URL("tokens.json", root), "utf8"));
const themes = t.color.themes.map((th) => th.id);
const [first] = themes;

const valueFor = (token, theme) => {
  const v = token.value;
  const raw = typeof v === "string" ? v : (v[theme] ?? v[first]);
  return raw.replace(/^\{(.+)\}$/, "var(--$1)");
};
const themed = [...t.color.tokens, ...(t.shadow?.tokens ?? [])];
const block = (theme) => themed.map((tok) => `  --${tok.name}: ${valueFor(tok, theme)};`).join("\n");

const flat = Object.entries(t)
  .filter(([k, v]) => !["color", "type", "shadow", "name", "version"].includes(k) && v?.tokens)
  .flatMap(([, fam]) => fam.tokens.map((tok) => `  --${tok.name}: ${tok.value};`));
const fonts = Object.entries(t.type.families).map(([k, v]) => `  --font-${k}: ${v};`);

const styles = t.type.groups.flatMap((g) =>
  g.styles.map((s) => {
    const fam = s.family ?? g.family;
    const decls = [
      `font-family: var(--font-${fam})`,
      `font-size: ${s.fontSize}`,
      s.lineHeight && `line-height: ${s.lineHeight}`,
      s.fontWeight && `font-weight: ${s.fontWeight}`,
      s.letterSpacing && `letter-spacing: ${s.letterSpacing}`,
      s.name === "overline" && "text-transform: uppercase",
      s.name === "metric" && "font-variant-numeric: tabular-nums",
    ].filter(Boolean);
    return `.text-${s.name} { ${decls.join("; ")}; }`;
  }),
);

const dark = themes.includes("dark") ? block("dark") : "";
const css = `/* GENERATED from tokens.json by scripts/build-tokens.mjs — do not edit by hand. */
:root, [data-theme="${first}"] {
${block(first)}
}
${themes
  .slice(1)
  .map((th) => `[data-theme="${th}"] {\n  color-scheme: ${th === "dark" ? "dark" : "light"};\n${block(th)}\n}`)
  .join("\n")}
${dark ? `@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {\n    color-scheme: dark;\n${dark.replace(/^/gm, "  ")}\n  }\n}` : ""}
:root {
${[...flat, ...fonts].join("\n")}
}
${styles.join("\n")}
`;
writeFileSync(new URL("styles/tokens.css", root), css);
console.log(`tokens.css: ${themed.length} themed tokens, ${flat.length} scale tokens, ${styles.length} text styles`);
