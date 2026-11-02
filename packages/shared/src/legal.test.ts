import { describe, expect, it } from "vitest";
import { markdownToHtml, markdownToText, parseMarkdown, policyByPath, policyTemplate, safeHref } from "./legal";

describe("legal markdown", () => {
  it("parses headings, paragraphs and lists", () => {
    const b = parseMarkdown("# Título\n\nUna línea\nque sigue.\n\n- uno\n- **dos**\n\n1. a\n2. b");
    expect(b.map((x) => x.t)).toEqual(["h2", "p", "ul", "ol"]);
    expect(markdownToText("- uno\n- dos")).toBe("- uno\n- dos");
  });
  it("escapes HTML and blocks dangerous links", () => {
    const html = markdownToHtml("<script>alert(1)</script> [x](javascript:alert(1)) [ok](https://a.mx) [rel](/terminos) [m](mailto:a@b.mx)");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('<a href="https://a.mx">ok</a>');
    expect(html).toContain('<a href="/terminos">rel</a>');
    expect(safeHref("data:text/html,x")).toBeNull();
    expect(safeHref("//evil.com")).toBeNull();
  });
  it("fills templates with the business data", () => {
    const t = policyTemplate("privacy", { name: "Casa Olivo", legalName: "Olivo SA de CV", email: "hola@olivo.mx", phone: null, address: "Calle 1", storeUrl: "https://t.mx/olivo" });
    expect(t).toContain("Olivo SA de CV");
    expect(t).toContain("hola@olivo.mx");
    expect(t).toContain("[teléfono]");
    expect(policyByPath("terminos")).toBe("terms");
    expect(policyByPath("x")).toBeNull();
  });
});
