import http from "node:http";

// Chromium-wide boundary: all HTTP targets (including workers) use this proxy.
// No CONNECT, upgrade, DNS lookup, redirects followed by Node, or direct fallback.
export async function previewProxy(origin, blocked) {
  const base = new URL(origin);
  const upstream = new Set();
  const server = http.createServer((req, res) => {
    let url;
    try {
      url = new URL(req.url);
    } catch {
      /* deny below */
    }
    if (!url || url.origin !== base.origin || url.username || url.password) {
      blocked();
      res.writeHead(403);
      res.end();
      return;
    }
    const headers = { ...req.headers, host: base.host, connection: "close" };
    delete headers["proxy-authorization"];
    delete headers["proxy-connection"];
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: base.port,
        path: url.pathname + url.search,
        method: req.method,
        headers,
        agent: false,
      },
      (response) => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      },
    );
    upstream.add(request);
    request.once("close", () => upstream.delete(request));
    request.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    res.once("close", () => request.destroy());
    req.pipe(request);
  });
  const deny = (_req, socket) => {
    blocked();
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
  };
  server.on("connection", (socket) => socket.on("error", () => {}));
  server.on("connect", deny);
  server.on("upgrade", deny);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    async close() {
      for (const request of upstream) request.destroy();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
