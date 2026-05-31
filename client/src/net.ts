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

  on(listener: Listener): void {
    this.listeners.add(listener);
  }
}
