/**
 * Live customer display on another device (Phase 8). One Durable Object per pairing code:
 * the register (signed in) pushes the state; displays (a tablet, a TV; no sign-in, only the code)
 * listen over a WebSocket. Uses the hibernation API, so idle displays cost nothing.
 * A code that nobody uses for 24 hours is erased.
 */
import { DurableObject } from "cloudflare:workers";

const IDLE_MS = 24 * 3600_000;

interface Meta { tenantId: string; createdAt: number }

export class DisplayHub extends DurableObject {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const meta = await this.ctx.storage.get<Meta>("meta");
    switch (`${request.method} ${url.pathname}`) {
      case "POST /init": {
        if (meta) return Response.json({ error: "taken" }, { status: 409 });
        const { tenantId } = (await request.json()) as { tenantId: string };
        await this.ctx.storage.put("meta", { tenantId, createdAt: Date.now() } satisfies Meta);
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
        return Response.json({ ok: true, displays: this.ctx.getWebSockets().length });
      }
      case "GET /state": {
        if (!meta) return Response.json({ error: "not_found" }, { status: 404 });
        const state = await this.ctx.storage.get<string>("state");
        return new Response(state ?? "null", { headers: { "content-type": "application/json" } });
      }
      case "GET /info": {
        if (!meta) return Response.json({ error: "not_found" }, { status: 404 });
        return Response.json({ tenantId: meta.tenantId, displays: this.ctx.getWebSockets().length });
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
      case "DELETE /": {
        if (!meta || meta.tenantId !== url.searchParams.get("tenantId")) return Response.json({ error: "not_found" }, { status: 404 });
        await this.end();
        return Response.json({ ok: true });
      }
    }
    return new Response("Not found", { status: 404 });
  }

  /** Displays only listen; a ping keeps proxies from closing the socket. */
  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (message === "ping") ws.send("pong");
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
