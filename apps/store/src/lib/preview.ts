/**
 * Live preview in the editor (Apariencia): the dashboard shows the real store in an iframe with
 * ?nx-preview=<token>. The token lets the store's API answer (even before the store is on) and the store
 * then accepts the editor's draft, but only:
 *  - inside a frame (window.parent !== window),
 *  - from that parent window (event.source),
 *  - from the dashboard's origin, which the API tells only to a valid token (StoreInfo.previewOrigin).
 * Nothing is tracked and no pixel loads while previewing.
 */
import { useEffect, useRef, useState } from "react";
import { blockSchema, DEFAULT_ANNOUNCEMENT, DEFAULT_THEME, NO_PIXELS, publicAppearance, type PublicAppearance, type StoreBlock, type StoreInfo } from "@nexo/shared";

const TOKEN = /^nxp_[A-Za-z0-9_-]{20,64}$/;

function readToken() {
  if (typeof window === "undefined" || window.parent === window) return null;
  const t = new URLSearchParams(window.location.search).get("nx-preview");
  return t && TOKEN.test(t) ? t : null;
}

/** Fixed for the life of the page: the SPA's own navigation drops the query string. */
export const previewToken = readToken();
export const inPreview = previewToken !== null;

type Msg = { type?: unknown; appearance?: unknown; id?: unknown };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function setCustomCss(css: string) {
  let el = document.getElementById("nx-custom-css") as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = "nx-custom-css";
    document.head.appendChild(el);
  }
  if (el.textContent !== css) el.textContent = css;
}

/**
 * The editor's draft over the saved appearance. A section that is invalid mid-edit (an empty button text,
 * say) keeps its last valid version instead of disappearing.
 */
export function usePreviewDraft(store: StoreInfo | null) {
  const [draft, setDraft] = useState<PublicAppearance | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const lastValid = useRef(new Map<string, StoreBlock>());
  const origin = inPreview ? (store?.previewOrigin ?? null) : null;
  const timezone = store?.timezone ?? "UTC";

  useEffect(() => {
    if (!origin) return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent || e.origin !== origin) return;
      const m = e.data as Msg;
      if (!isObj(m)) return;
      if (m.type === "nx-preview:select") setSelected(typeof m.id === "string" ? m.id : null);
      if (m.type !== "nx-preview:appearance" || !isObj(m.appearance)) return;
      const a = m.appearance;
      const blocks: StoreBlock[] = [];
      for (const raw of Array.isArray(a.blocks) ? a.blocks : []) {
        const r = blockSchema.safeParse(raw);
        const id = isObj(raw) && typeof raw.id === "string" ? raw.id : null;
        if (r.success) {
          lastValid.current.set(r.data.id, r.data);
          blocks.push(r.data);
        } else if (id && lastValid.current.has(id)) blocks.push(lastValid.current.get(id)!);
      }
      const today = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
      setDraft(
        publicAppearance(
          {
            theme: isObj(a.theme) ? { ...DEFAULT_THEME, ...(a.theme as object) } : DEFAULT_THEME,
            announcement: isObj(a.announcement)
              ? {
                  ...DEFAULT_ANNOUNCEMENT,
                  ...(a.announcement as object),
                  messages: (Array.isArray(a.announcement.messages) ? a.announcement.messages : [])
                    .filter((x): x is { text: string; link: string | null } => isObj(x) && typeof x.text === "string")
                    .map((x) => ({ text: x.text, link: typeof x.link === "string" ? x.link : null })),
                }
              : DEFAULT_ANNOUNCEMENT,
            blocks,
            pixels: NO_PIXELS,
          },
          today,
        ),
      );
      if (isObj(a.code) && typeof a.code.css === "string") setCustomCss(a.code.css);
    };
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: "nx-preview:ready" }, origin);
    return () => window.removeEventListener("message", onMessage);
  }, [origin, timezone]);

  return { draft, selected };
}
