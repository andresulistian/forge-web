import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createInflate } from "node:zlib";
import { DevTools } from "./browser-tests.mjs";
import { previewProxy } from "./preview-proxy.mjs";

// PNG's specified CRC-32 (W3C PNG appendix). Chrome intentionally tolerates
// bad CRCs, so enforce the container checksum IN ADDITION to native decoding.
const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function pngContainer(bytes) {
  let ended = false,
    hasPixels = false;
  const compressed = [];
  const animation = [];
  const defaultChunks = [bytes.subarray(0, 8)];
  let animated = false;
  let frameData = [];
  for (let offset = 8; offset < bytes.length;) {
    if (offset + 12 > bytes.length) throw Error("PNG terpotong; unggah ulang.");
    const size = bytes.readUInt32BE(offset),
      end = offset + 12 + size;
    if (end > bytes.length) throw Error("Chunk PNG terpotong; unggah ulang.");
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (offset === 8 && (type !== "IHDR" || size !== 13))
      throw Error("Header PNG tidak valid.");
    let crc = 0xffffffff;
    for (let index = offset + 4; index < end - 4; index++)
      crc = crcTable[(crc ^ bytes[index]) & 255] ^ (crc >>> 8);
    if ((crc ^ 0xffffffff) >>> 0 !== bytes.readUInt32BE(end - 4))
      throw Error("Checksum PNG rusak; unggah ulang.");
    // PNG3 §4.9.1: IDAT may be outside the animation. Native animation
    // decoding alone then never reads that raster. Remove ONLY APNG chunks
    // for a separate native default-image decode; retain all PNG metadata
    // and the original checksummed chunks (including palette/transparency).
    if (["acTL", "fcTL", "fdAT"].includes(type)) animated = true;
    else defaultChunks.push(bytes.subarray(offset, end));
    if (type === "IDAT") {
      hasPixels = true;
      compressed.push(bytes.subarray(offset + 8, end - 4));
    }
    if (type === "fcTL" && frameData.length) {
      animation.push(Buffer.concat(frameData));
      frameData = [];
    }
    if (type === "fdAT") {
      if (size < 4) throw Error("Frame PNG terpotong.");
      frameData.push(bytes.subarray(offset + 12, end - 4));
    }
    if (type === "IEND") {
      if (size || end !== bytes.length) throw Error("Penutup PNG tidak valid.");
      ended = true;
    }
    offset = end;
  }
  if (!ended || !hasPixels) throw Error("PNG tidak lengkap; unggah ulang.");
  if (frameData.length) animation.push(Buffer.concat(frameData));
  return {
    compressed: [Buffer.concat(compressed), ...animation],
    defaultImage: animated ? Buffer.concat(defaultChunks) : null,
  };
}

// Chrome also tolerates a bad zlib Adler checksum. The standard zlib decoder
// verifies the compressed stream independently, discarding output as it arrives.
// Never buffer expanded pixels or write a handwritten PNG pixel decoder.
async function verifyDeflate(bytes, maximum, deadline) {
  await new Promise((resolve, reject) => {
    const inflate = createInflate();
    let length = 0;
    const timer = setTimeout(
      () =>
        inflate.destroy(Error("Verifikasi kompresi gambar melebihi 5 detik.")),
      Math.max(1, deadline - Date.now()),
    );
    inflate.on("data", (chunk) => {
      length += chunk.length;
      if (length > maximum)
        inflate.destroy(Error("Data piksel PNG melebihi batas dimensi."));
    });
    inflate.once("error", () => {
      clearTimeout(timer);
      reject(
        Error("Data kompresi PNG rusak atau terlalu besar; unggah ulang."),
      );
    });
    inflate.once("end", () => {
      clearTimeout(timer);
      resolve();
    });
    inflate.end(bytes);
  });
}

// Headers are only an allocation preflight, NEVER proof of a valid raster.
// Acceptance requires complete native decoding in a sandboxed, offline Chrome.
function dimensions(bytes, mimeType) {
  if (
    mimeType === "image/png" &&
    bytes.length >= 33 &&
    bytes.toString("ascii", 12, 16) === "IHDR"
  )
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  if (mimeType === "image/gif" && bytes.length >= 14 && bytes.at(-1) === 0x3b)
    return [bytes.readUInt16LE(6), bytes.readUInt16LE(8)];
  if (
    mimeType === "image/webp" &&
    bytes.length >= 30 &&
    bytes.readUInt32LE(4) + 8 === bytes.length
  ) {
    const type = bytes.toString("ascii", 12, 16);
    if (type === "VP8X")
      return [bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1];
    if (type === "VP8 " && bytes.toString("hex", 23, 26) === "9d012a")
      return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
    if (type === "VP8L" && bytes[20] === 0x2f) {
      const bits = bytes.readUInt32LE(21);
      return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
    }
  }
  if (
    mimeType === "image/jpeg" &&
    bytes.length >= 4 &&
    bytes.at(-2) === 0xff &&
    bytes.at(-1) === 0xd9
  ) {
    for (let offset = 2; offset + 4 <= bytes.length;) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker) &&
        length >= 8
      )
        return [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)];
      offset += length;
    }
  }
  throw Error(
    "Struktur gambar tidak valid; unggah ulang gambar PNG/JPEG/WebP/GIF yang dapat dibaca.",
  );
}

async function findBrowser() {
  const candidates =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
          "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        ]
      : [
          "/usr/bin/google-chrome",
          "/usr/bin/chromium",
          "/usr/bin/chromium-browser",
          "/opt/google/chrome/chrome",
        ];
  for (const file of candidates) {
    try {
      await fs.access(file);
      return file;
    } catch {
      /* try next */
    }
  }
  throw Error(
    "Chrome/Chromium diperlukan untuk memverifikasi gambar. Gambar tidak disimpan; coba lagi setelah browser tersedia.",
  );
}

let worker;
let serial = Promise.resolve();
let waiting = 0;
let idle;
let stopping = false;
const verified = new Map();

async function startWorker() {
  const binary = await findBrowser();
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "forge-raster-"));
  const page = http.createServer((_request, response) => {
    response.writeHead(200, {
      "Content-Type": "text/html",
      "Content-Security-Policy": "default-src 'none'",
      "Cache-Control": "no-store",
    });
    response.end("<!doctype html><title>Private raster decoder</title>");
  });
  let proxy, child, client;
  let cleanup;
  const close = () =>
    (cleanup ||= (async () => {
      client?.close();
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = new Promise((resolve) => child.once("exit", resolve));
        child.kill("SIGTERM");
        const force = setTimeout(() => child.kill("SIGKILL"), 500);
        await exited;
        clearTimeout(force);
      }
      await proxy?.close();
      await new Promise((resolve) => page.close(resolve));
      await fs.rm(profile, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    })());
  try {
    await new Promise((resolve, reject) => {
      page.once("error", reject);
      page.listen(0, "127.0.0.1", resolve);
    });
    const origin = `http://127.0.0.1:${page.address().port}`;
    proxy = await previewProxy(origin, () => {});
    child = spawn(
      binary,
      [
        "--headless=new",
        "--password-store=basic",
        "--use-mock-keychain",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-sync",
        "--disable-features=Translate",
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
        `--proxy-server=${proxy.url}`,
        "--proxy-bypass-list=<-loopback>",
        "--disable-quic",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        "--remote-debugging-port=0",
        `--user-data-dir=${profile}`,
        "about:blank",
      ],
      {
        stdio: "ignore",
        // The pixel decoder needs no Forge/provider/SSH/deployment credentials.
        env: { PATH: process.env.PATH, HOME: profile, TMPDIR: profile },
      },
    );
    let failed;
    child.once("error", (error) => {
      failed = error;
    });
    const deadline = Date.now() + 5000;
    let port;
    while (!port && Date.now() < deadline) {
      if (failed || child.exitCode !== null)
        throw Error("Decoder gambar gagal dijalankan.");
      try {
        const value = (
          await fs.readFile(path.join(profile, "DevToolsActivePort"), "utf8")
        ).split("\n")[0];
        if (/^\d+$/.test(value)) port = value;
      } catch {
        /* browser starting */
      }
      if (!port) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!port) throw Error("Decoder gambar tidak siap dalam 5 detik.");
    const pages = await (
      await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(5000),
      })
    ).json();
    const target = pages.find((value) => value.type === "page");
    if (!target) throw Error("Decoder gambar tidak tersedia.");
    client = new DevTools(target.webSocketDebuggerUrl, (method, params) => {
      if (method === "Fetch.requestPaused")
        void client
          .send("Fetch.failRequest", {
            requestId: params.requestId,
            errorReason: "BlockedByClient",
          })
          .catch(() => {});
    });
    await client.send("Page.enable");
    await client.send("Page.navigate", { url: origin });
    // Let the empty local secure-context document finish; then deny EVERY request.
    for (;;) {
      const ready = await client.send("Runtime.evaluate", {
        expression: "isSecureContext && typeof ImageDecoder === 'function'",
        returnByValue: true,
      });
      if (ready.result.value) break;
      if (Date.now() >= deadline)
        throw Error("Browser tidak mendukung decoder gambar yang aman.");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await client.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    return { client, close };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function verifyRaster(bytes, mimeType, frame = false) {
  if (stopping) throw Error("Decoder gambar sedang ditutup.");
  const container = mimeType === "image/png" ? pngContainer(bytes) : null;
  const compressed = container?.compressed;
  const [width, height] = dimensions(bytes, mimeType);
  const maximum = frame ? 1600 : 32768;
  const pixels = frame ? 1600 * 1600 : 40_000_000;
  if (
    !width ||
    !height ||
    width > maximum ||
    height > maximum ||
    width * height > pixels
  )
    throw Error(
      frame
        ? "Frame maksimal 1600 × 1600 piksel; unggah ulang melalui Forge."
        : "Dimensi gambar asli maksimal 32768 dan 40 juta piksel.",
    );
  if (
    compressed &&
    (compressed.length > 128 || compressed.length * width * height > 40_000_000)
  )
    throw Error("Terlalu banyak frame/piksel gambar PNG.");
  const key = createHash("sha256").update(mimeType).update(bytes).digest("hex");
  if (verified.has(key)) return;
  if (waiting >= 16) throw Error("Verifikasi gambar sedang penuh; coba lagi.");
  waiting++;
  clearTimeout(idle);
  const task = serial.then(async () => {
    if (stopping) throw Error("Decoder gambar sedang ditutup.");
    // RGBA16 is the largest supported PNG pixel; seven Adam7 passes add at
    // most seven filter bytes per row. Enforce this before native allocation.
    if (compressed) {
      const deadline = Date.now() + 5000;
      for (const packed of compressed)
        await verifyDeflate(packed, width * height * 8 + height * 7, deadline);
    }
    worker ||= await startWorker();
    const current = worker;
    if (stopping) {
      worker = undefined;
      await current.close();
      throw Error("Decoder gambar sedang ditutup.");
    }
    let timer;
    try {
      const result = await Promise.race([
        current.client.send("Runtime.evaluate", {
          expression: `(async()=>{
            for(const encoded of ${JSON.stringify((container?.defaultImage ? [container.defaultImage, bytes] : [bytes]).map((value) => value.toString("base64")))}) {
            const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
            const decoder=new ImageDecoder({data:bytes,type:${JSON.stringify(mimeType)},preferAnimation:true});
            try {
              await decoder.tracks.ready; await decoder.completed;
              const track=decoder.tracks.selectedTrack;
              if(!track||!track.frameCount||track.frameCount>128||track.frameCount*${width * height}>40000000) throw Error('Terlalu banyak frame/piksel gambar.');
              for(let index=0;index<track.frameCount;index++) {
                const decoded=await decoder.decode({frameIndex:index,completeFramesOnly:true});
                try { if(!decoded.complete||!decoded.image.displayWidth||!decoded.image.displayHeight||decoded.image.displayWidth>${maximum}||decoded.image.displayHeight>${maximum}||decoded.image.displayWidth*decoded.image.displayHeight>${pixels}) throw Error('Dimensi raster hasil decode tidak valid.'); }
                finally { decoded.image.close(); }
              }
            } finally { decoder.close(); }
            }
            return true;
          })()`,
          returnByValue: true,
          awaitPromise: true,
        }),
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                Error(
                  "Verifikasi gambar melebihi 5 detik; unggah gambar lebih kecil.",
                ),
              ),
            5000,
          );
        }),
      ]);
      if (result.exceptionDetails || result.result.value !== true)
        throw Error(
          "Gambar tidak dapat didekode lengkap; unggah ulang raster yang valid.",
        );
      verified.set(key, true);
      if (verified.size > 64) verified.delete(verified.keys().next().value);
    } catch (error) {
      worker = undefined;
      await current.close();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  });
  serial = task.catch(() => {});
  try {
    await task;
  } finally {
    waiting--;
    if (!waiting && !stopping)
      idle = setTimeout(() => {
        const current = worker;
        worker = undefined;
        // Serialize cleanup as well: a new request cannot use a closing decoder.
        serial = serial.then(() => current?.close()).catch(() => {});
      }, 500);
  }
}

export async function closeRasterDecoder() {
  stopping = true;
  clearTimeout(idle);
  const current = worker;
  worker = undefined;
  await current?.close();
  // Queued work fails closed; a browser still starting observes stopping and
  // cleans itself up before this resolves. Never leave an owned Chrome orphan.
  await serial;
}
