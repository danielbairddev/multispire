import type { ClientMessage, ServerMessage } from "@multispire/shared";

type Listener = (msg: ServerMessage) => void;

export class Net {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private queue: ClientMessage[] = [];

  connect(): void {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onopen = () => {
      for (const m of this.queue) this.ws!.send(JSON.stringify(m));
      this.queue = [];
    };
    this.ws.onmessage = (ev) => {
      const msg: ServerMessage = JSON.parse(ev.data);
      for (const l of this.listeners) l(msg);
    };
    this.ws.onclose = () => {
      // Simple auto-reconnect after a short delay.
      setTimeout(() => this.connect(), 1000);
    };
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else this.queue.push(msg);
  }

  /** Drop the current connection and open a fresh one. The server detaches the
   *  old identity from its match on close, so we come back as a clean player. */
  reset(): void {
    const old = this.ws;
    this.ws = null;
    this.queue = [];
    if (old) {
      old.onclose = null; // suppress this socket's auto-reconnect; we reconnect below
      old.onmessage = null;
      try {
        old.close();
      } catch {
        /* ignore */
      }
    }
    this.connect();
  }

  on(listener: Listener): void {
    this.listeners.add(listener);
  }
}
