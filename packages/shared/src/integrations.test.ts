import { describe, expect, it } from "vitest";
import { API_KEY_ACCESS, WEBHOOK_MAX_ATTEMPTS, WEBHOOK_RETRY_MINUTES, webhookUrlProblem } from "./integrations";
import { can } from "./roles";
import { PLANS } from "./plans";

describe("webhook URLs", () => {
  it.each([
    ["https://hooks.zapier.com/hooks/catch/1/abc", null],
    ["https://mi-erp.example.com:8443/nexo", null],
    ["http://example.com/hook", "Debe empezar con https://"],
    ["ftp://example.com", "Debe empezar con https://"],
    ["https://user:pass@example.com/", "Sin usuario ni contraseña en la dirección"],
    ["https://localhost/hook", "Usa una dirección pública de internet"],
    ["https://127.0.0.1/hook", "Usa una dirección pública de internet"],
    ["https://10.1.2.3/hook", "Usa una dirección pública de internet"],
    ["https://192.168.0.10/hook", "Usa una dirección pública de internet"],
    ["https://172.20.0.1/hook", "Usa una dirección pública de internet"],
    ["https://169.254.169.254/latest", "Usa una dirección pública de internet"],
    ["https://[::1]/hook", "Usa una dirección pública de internet"],
    ["https://intranet/hook", "Usa una dirección pública de internet"],
    ["https://db.internal/hook", "Usa una dirección pública de internet"],
    ["no es url", "Dirección no válida"],
  ])("%s", (url, problem) => expect(webhookUrlProblem(url)).toBe(problem));
  it("development allows local http", () => {
    expect(webhookUrlProblem("http://127.0.0.1:12115/hook", true)).toBeNull();
  });
});

describe("API keys and plans", () => {
  it("no key acts as owner, and read-only keys are admins without writes", () => {
    for (const a of Object.values(API_KEY_ACCESS)) expect(a.role).not.toBe("owner");
    expect(API_KEY_ACCESS.read.readOnly).toBe(true);
    expect(can(API_KEY_ACCESS.pos.role, "reports:read")).toBe(false);
    expect(can(API_KEY_ACCESS.full.role, "billing:write")).toBe(false);
  });
  it("plans grow their integration limits", () => {
    expect(PLANS.free.limits.apiKeys).toBe(2);
    expect(PLANS.free.limits.webhooks).toBe(1);
    expect(PLANS.business.limits.webhooks).toBeNull();
  });
  it("retries add up to about a day", () => {
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(6);
    expect(WEBHOOK_RETRY_MINUTES.reduce((a, b) => a + b, 0)).toBeGreaterThan(24 * 60);
  });
});
