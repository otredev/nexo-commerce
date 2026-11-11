/**
 * Live customer display on another device (Phase 8). One Durable Object per pairing code:
 * the register (signed in) pushes the state; displays (a tablet, a TV; no sign-in, only the code)
 * listen over a WebSocket. Uses the hibernation API, so idle displays cost nothing.
 * A code that nobody uses for 24 hours is erased.
 *
 * A display may send back only what the register is asking for right now (same request id): the
 * customer's optional sign-up or «Ya soy cliente» during the sale, and how they want the receipt after
 * paying. It waits in an inbox that the register picks up; the register acts with its own session and
 * permissions (creates or looks up the customer, sends the receipt).
 */
import { DurableObject } from "cloudflare:workers";
import { DISPLAY_MESSAGE_MAX, displayDeviceMessageSchema, displayMessageAllowed, displaySignupMessageSchema, type DisplayDevice, type DisplayState } from "@nexo/shared";

const IDLE_MS = 24 * 3600_000;

interface Meta { tenantId: string; createdAt: number; locationId?: string | null }

export class DisplayHub extends DurableObject {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const meta = await this.ctx.storage.get<Meta>("meta");
    switch (`${request.method} ${url.pathname}`) {
      case "POST /init": {
        if (meta) return Response.json({ error: "taken" }, { status: 409 });
        const { tenantId, locationId } = (await request.json()) as { tenantId: string; locationId?: string | null };
        await this.ctx.storage.put("meta", { tenantId, locationId: locationId ?? null, createdAt: Date.now() } satisfies Meta);
        await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
        return Response.json({ ok: true });
      }
      case "POST /state": {
        const body = (await request.json()) as { tenantId: string; state: unknown };
        if (!meta || meta.tenantId !== body.tenantId) return Response.json({ error: "not_found" }, { status: 404 });
        const text = JSON.stringify(body.state);
        await this.ctx.storage.put("state", text);
        await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
        for (const ws of this.ctx.getWebSockets()) {
          try { ws.send(text); } catch { /* closed */ }
        }
        const device = (await this.ctx.storage.get<DisplayDevice>("device")) ?? null;
        return Response.json({ ok: true, displays: this.ctx.getWebSockets().length, device });
      }
      case "GET /state": {
        if (!meta) return Response.json({ error: "not_found" }, { status: 404 });
        const state = await this.ctx.storage.get<string>("state");
        return new Response(state ?? "null", { headers: { "content-type": "application/json" } });
      }
      case "GET /info": {
        if (!meta) return Response.json({ error: "not_found" }, { status: 404 });
        return Response.json({ tenantId: meta.tenantId, locationId: meta.locationId ?? null, displays: this.ctx.getWebSockets().length });
      }
      case "GET /ws": {
        if (!meta) return new Response("Código no válido", { status: 404 });
        if (request.headers.get("upgrade") !== "websocket") return new Response("Expected websocket", { status: 426 });
        const pair = new WebSocketPair();
        this.ctx.acceptWebSocket(pair[1]);
        const state = await this.ctx.storage.get<string>("state");
        if (state) pair[1].send(state);
        return new Response(null, { status: 101, webSocket: pair[0] });
      }
      case "GET /inbox": {
        if (!meta || meta.tenantId !== url.searchParams.get("tenantId")) return Response.json({ error: "not_found" }, { status: 404 });
        const msg = await this.ctx.storage.get<string>("inbox");
        if (msg) await this.ctx.storage.delete("inbox");
        return new Response(msg ?? "[]", { headers: { "content-type": "application/json" } });
      }
      case "DELETE /": {
        if (!meta || meta.tenantId !== url.searchParams.get("tenantId")) return Response.json({ error: "not_found" }, { status: 404 });
        await this.end();
        return Response.json({ ok: true });
      }
    }
    return new Response("Not found", { status: 404 });
  }

  /** A ping keeps proxies from closing the socket; the only other message is the sign-up the register asked for. */
  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (message === "ping") return ws.send("pong");
    if (typeof message !== "string" || message.length > DISPLAY_MESSAGE_MAX) return;
    let parsed: unknown;
    try { parsed = JSON.parse(message); } catch { return; }
    // The display app says whether it can take cards (Tap to Pay) and if its reader is ready.
    const dev = displayDeviceMessageSchema.safeParse(parsed);
    if (dev.success) {
      const { type: _, ...device } = dev.data;
      return this.ctx.storage.put("device", device);
    }
    const r = displaySignupMessageSchema.safeParse(parsed);
    if (!r.success) return;
    const stored = await this.ctx.storage.get<string>("state");
    let state: DisplayState | null = null;
    try { state = stored ? (JSON.parse(stored) as DisplayState) : null; } catch { /* no state */ }
    if (!displayMessageAllowed(state, r.data)) return;
    // A few messages may arrive between two polls of the register (e.g. «Ya soy cliente», then «Registrarme»).
    const inbox = JSON.parse((await this.ctx.storage.get<string>("inbox")) ?? "[]") as unknown[];
    await this.ctx.storage.put("inbox", JSON.stringify([...inbox, r.data].slice(-5)));
  }

  override async webSocketClose(ws: WebSocket, code: number) {
    try { ws.close(code, "bye"); } catch { /* already closed */ }
  }

  override async alarm() {
    await this.end();
  }

  private async end() {
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.close(4000, "Emparejamiento terminado"); } catch { /* closed */ }
    }
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
  }
}
