export type Project = { id: string; name: string; path: string };
export type Message = {
  role: string;
  text: string;
  mode?: string;
  attachments?: { id: string; name: string; kind: string }[];
  provider?: string;
  model?: string;
  multiAgent?: boolean;
  sources?: { title: string; url: string; snippet?: string }[];
  checkedAt?: string;
};
export type Checkpoint = { id: string; label: string; date: string };
export type ForgeEvent = {
  id: number;
  type: string;
  payload: any;
  time: number;
};
let connection: { url: string; token: string };
export async function connect() {
  const token =
    new URLSearchParams(location.hash.slice(1)).get("token") ||
    sessionStorage.getItem("forge-token") ||
    "";
  if (token) {
    sessionStorage.setItem("forge-token", token);
    history.replaceState(null, "", location.pathname);
  }
  connection = { url: location.origin, token };
  return connection;
}
export async function api<T = any>(route: string, data?: unknown): Promise<T> {
  const res = await fetch(connection.url + "/api/" + route, {
    method: data ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + connection.token,
      ...(data ? { "Content-Type": "application/json" } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const value = await res.json();
  if (!res.ok) {
    if (res.status === 401) {
      throw Error("Sesi habis atau server restart. Tutup tab ini dan buka ulang dari launcher Forge Web.");
    }
    throw Error(value.error || "Operasi gagal.");
  }
  return value;
}
export async function subscribe(
  signal: AbortSignal,
  onEvent: (e: ForgeEvent) => void,
  onStatus: (ok: boolean) => void,
  after = 0,
) {
  let last = after;
  while (!signal.aborted) {
    try {
      const res = await fetch(connection.url + "/api/events?after=" + last, {
        headers: { Authorization: "Bearer " + connection.token },
        signal,
      });
      if (!res.ok || !res.body) throw Error("Stream gagal");
      onStatus(true);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        let n;
        while ((n = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, n);
          buffer = buffer.slice(n + 1);
          if (line.trim()) {
            const e = JSON.parse(line);
            last = e.id;
            onEvent(e);
          }
        }
      }
    } catch (err) {
      onStatus(false);
      if ((err as Error).message.includes("401")) {
        throw err;
      }
    }
    if (!signal.aborted) await new Promise((r) => setTimeout(r, 2000));
  }
}
