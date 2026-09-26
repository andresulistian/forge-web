import http from "node:http";
import fs from "node:fs/promises";
const i = process.argv.indexOf("--port");
const port = Number(i >= 0 ? process.argv[i + 1] : process.env.PORT || 5173);
http
  .createServer(async (req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(await fs.readFile(new URL("./index.html", import.meta.url)));
  })
  .listen(port, "127.0.0.1", () =>
    console.log(`Preview: http://127.0.0.1:${port}`),
  );
