import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { execFile } from "node:child_process";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { promisify } from "node:util";
import { isolatedForge } from "./visual-fixtures.mjs";
import { verifyRaster, closeRasterDecoder } from "../server/raster-decoder.mjs";
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const processes = promisify(execFile);
// Independent fixture encoder; works on the declared Node 22.13 minimum too.
const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const value of bytes) crc = crcTable[(crc ^ value) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const b = Buffer.alloc(data.length + 12);
  b.writeUInt32BE(data.length);
  b.write(type, 4);
  data.copy(b, 8);
  b.writeUInt32BE(crc32(b.subarray(4, -4)), b.length - 4);
  return b;
}
function png(width = 1, height = 1, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    signature,
    chunk("IHDR", header),
    chunk(
      "IDAT",
      deflateSync(pixels || Buffer.alloc(height * (width * 4 + 1))),
    ),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const item = (bytes) => ({
  kind: "image",
  name: "raster.png",
  images: [{ data: bytes.toString("base64"), mimeType: "image/png" }],
});

test("signature-only raster is rejected on NEW upload and legacy private preview", async (t) => {
  const forge = await isolatedForge(t);
  const project = await forge.json("projects/create", {
    name: "Raster verification",
  });
  const response = await forge.request("attachments", {
    projectId: project.id,
    item: item(signature),
  });
  assert.equal(
    response.status,
    400,
    "an eight-byte signature is not a decoded raster",
  );
  const valid = await forge.json("attachments", {
    projectId: project.id,
    item: item(png()),
  });
  const file = path.join(
    forge.root,
    "data/attachments",
    project.id,
    valid.id + ".json",
  );
  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  await fs.writeFile(
    file,
    JSON.stringify({ ...saved, images: item(signature).images }),
  );
  const preview = await forge.request(
    `attachments/image?projectId=${project.id}&id=${valid.id}`,
  );
  assert.equal(preview.status, 400);
  assert.match((await preview.json()).error, /gambar|frame|unggah|raster/i);
});

test("PNG chunk CRC, deflate, filter/pixel corruption and truncation never become verified previews", async (t) => {
  const forge = await isolatedForge(t);
  const project = await forge.json("projects/create", {
    name: "Corrupt rasters",
  });
  const valid = png();
  const crc = Buffer.from(valid);
  crc[crc.length - 1] ^= 1;
  const header = valid.subarray(8, 33);
  const badAdler = deflateSync(Buffer.alloc(5));
  badAdler[badAdler.length - 1] ^= 1;
  const variants = [
    ["CRC", crc],
    ["truncated", valid.subarray(0, -12)],
    [
      "deflate",
      Buffer.concat([
        signature,
        header,
        chunk("IDAT", Buffer.from([1, 2, 3, 4])),
        chunk("IEND", Buffer.alloc(0)),
      ]),
    ],
    [
      "deflate checksum",
      Buffer.concat([
        signature,
        header,
        chunk("IDAT", badAdler),
        chunk("IEND", Buffer.alloc(0)),
      ]),
    ],
    ["invalid pixel filter", png(1, 1, Buffer.from([99, 0, 0, 0, 0]))],
    ["insufficient pixel rows", png(2, 2, Buffer.from([0, 0, 0, 0, 0]))],
  ];
  const saved = await forge.json("attachments", {
    projectId: project.id,
    item: item(valid),
  });
  const file = path.join(
    forge.root,
    "data/attachments",
    project.id,
    saved.id + ".json",
  );
  const original = JSON.parse(await fs.readFile(file, "utf8"));
  for (const [name, bytes] of variants) {
    const response = await forge.request("attachments", {
      projectId: project.id,
      item: item(bytes),
    });
    assert.equal(
      response.status,
      400,
      `${name}: NEW upload must reject corrupt bytes`,
    );
    await fs.writeFile(
      file,
      JSON.stringify({ ...original, images: item(bytes).images }),
    );
    const preview = await forge.request(
      `attachments/image?projectId=${project.id}&id=${saved.id}`,
    );
    assert.equal(
      preview.status,
      400,
      `${name}: legacy read must reject corrupt bytes`,
    );
  }
});

export { png, item, chunk };

test("APNG cannot hide an invalid default IDAT raster outside its animation", async (t) => {
  const forge = await isolatedForge(t);
  const project = await forge.json("projects/create", {
    name: "APNG default validation",
  });
  const control = Buffer.alloc(8);
  control.writeUInt32BE(1);
  const frame = Buffer.alloc(26);
  frame.writeUInt32BE(1, 4);
  frame.writeUInt32BE(1, 8);
  frame.writeUInt16BE(1, 20);
  frame.writeUInt16BE(10, 22);
  const sequence = Buffer.alloc(4);
  sequence.writeUInt32BE(1);
  const animated = (base, animationPixels = Buffer.from([0, 0, 255, 0, 255])) =>
    Buffer.concat([
      signature,
      base.subarray(8, 33),
      chunk("acTL", control),
      // IDAT before fcTL: the default image is NOT an animation frame.
      base.subarray(33, -12),
      chunk("fcTL", frame),
      chunk("fdAT", Buffer.concat([sequence, deflateSync(animationPixels)])),
      base.subarray(-12),
    ]);
  const invalid = png(1, 1, Buffer.from([99, 0, 0, 0, 255]));
  const staticResponse = await forge.request("attachments", {
    projectId: project.id,
    item: item(invalid),
  });
  const animatedResponse = await forge.request("attachments", {
    projectId: project.id,
    item: item(animated(invalid)),
  });
  const response = await animatedResponse.json();
  const preview = response.id
    ? await forge.request(
        `attachments/image?projectId=${project.id}&id=${response.id}`,
      )
    : null;
  console.log(
    "APNG_DEFAULT_EVIDENCE",
    JSON.stringify({
      staticDefaultStatus: staticResponse.status,
      apngStatus: animatedResponse.status,
      previewStatus: preview?.status,
      filterByte: 99,
      evidenceRoot: forge.root,
    }),
  );
  assert.equal(
    staticResponse.status,
    400,
    "identical default IDAT is invalid as an ordinary PNG",
  );
  assert.equal(
    animatedResponse.status,
    400,
    "a valid separate animation cannot validate the corrupt default raster",
  );

  const valid = await forge.json("attachments", {
    projectId: project.id,
    item: item(animated(png())),
  });
  const previewRoute = `attachments/image?projectId=${project.id}&id=${valid.id}`;
  assert.equal(
    (await forge.request(previewRoute)).status,
    200,
    "valid APNG with excluded default is supported",
  );
  assert.equal(
    (await forge.request(previewRoute, undefined, false)).status,
    401,
  );
  const indexedHeader = Buffer.alloc(13);
  indexedHeader.writeUInt32BE(1);
  indexedHeader.writeUInt32BE(1, 4);
  indexedHeader[8] = 8;
  indexedHeader[9] = 3;
  const indexed = Buffer.concat([
    signature,
    chunk("IHDR", indexedHeader),
    chunk("PLTE", Buffer.from([0, 0, 0, 0, 255, 0])),
    chunk("tRNS", Buffer.from([0, 255])),
    chunk("IDAT", deflateSync(Buffer.from([0, 0]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  assert.equal(
    (
      await forge.request("attachments", {
        projectId: project.id,
        item: item(animated(indexed, Buffer.from([0, 1]))),
      })
    ).status,
    200,
    "default decode retains palette and transparency metadata",
  );
  const other = await forge.json("projects/create", { name: "APNG isolation" });
  assert.equal(
    (
      await forge.request(
        `attachments/image?projectId=${other.id}&id=${valid.id}`,
      )
    ).status,
    404,
  );
  const file = path.join(
    forge.root,
    "data/attachments",
    project.id,
    valid.id + ".json",
  );
  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  for (const [label, bytes] of [
    ["invalid default", animated(invalid)],
    ["invalid animation", animated(png(), Buffer.from([99, 0, 255, 0, 255]))],
  ]) {
    assert.equal(
      (
        await forge.request("attachments", {
          projectId: project.id,
          item: item(bytes),
        })
      ).status,
      400,
      label + " upload",
    );
    await fs.writeFile(
      file,
      JSON.stringify({ ...saved, images: item(bytes).images }),
    );
    assert.equal(
      (await forge.request(previewRoute)).status,
      400,
      label + " legacy preview",
    );
  }
});

test("native decoder has no Forge credentials in its child environment", async (t) => {
  const key = "FORGE_DECODER_SENTINEL_TOKEN",
    previous = process.env[key];
  const spawn = childProcess.spawn;
  let environment;
  // Record the environment of the REAL spawn; do not replace the decoder.
  childProcess.spawn = (binary, args, options) => {
    if (args.some((value) => value.includes("/forge-raster-")))
      environment = options.env;
    return spawn(binary, args, options);
  };
  syncBuiltinESMExports();
  process.env[key] = "fixture-only-not-a-real-credential";
  t.after(async () => {
    childProcess.spawn = spawn;
    syncBuiltinESMExports();
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
    await closeRasterDecoder();
  });
  await verifyRaster(png(), "image/png", true);
  const { stdout } = await processes("ps", ["-axo", "pid=,ppid=,args="]);
  const child = stdout
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .find(
      (parts) =>
        Number(parts[1]) === process.pid &&
        parts.join(" ").includes("--headless=new") &&
        parts.join(" ").includes("/forge-raster-"),
    );
  assert.ok(child, "real decoder child exists");
  assert.equal(
    Object.hasOwn(environment, key),
    false,
    "decoder must not inherit even FORGE-prefixed credential variables",
  );
});

test("server shutdown stops its owned raster browser, rather than orphaning the sandbox", async (t) => {
  const forge = await isolatedForge(t),
    project = await forge.json("projects/create", {
      name: "Decoder lifecycle",
    });
  const owned = async () => {
    const { stdout } = await processes("ps", ["-axo", "pid=,args="]);
    return stdout
      .split("\n")
      .filter(
        (line) =>
          line.includes("--headless=new") &&
          !line.includes("--type=") &&
          line.includes("--user-data-dir=" + forge.root + "/forge-raster-"),
      )
      .map((line) => Number(line.trim().split(/\s+/)[0]));
  };
  await forge.json("attachments", { projectId: project.id, item: item(png()) });
  const pids = await owned();
  assert.equal(pids.length, 1, "a real sandboxed decoder was exercised");
  t.after(() => {
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* already exited */
      }
    }
  });
  await forge.stop();
  assert.deepEqual(
    await owned(),
    [],
    "shutdown must not leave a live Chrome decoder",
  );
  console.log("Evidence", forge.root);
});

test("animated PNG verifies the compressed data of later frames too", async (t) => {
  const forge = await isolatedForge(t),
    project = await forge.json("projects/create", {
      name: "Animated compression",
    });
  const base = png(),
    control = Buffer.alloc(8);
  control.writeUInt32BE(2);
  const frame = (sequence) => {
    const b = Buffer.alloc(26);
    b.writeUInt32BE(sequence);
    b.writeUInt32BE(1, 4);
    b.writeUInt32BE(1, 8);
    b.writeUInt16BE(1, 20);
    b.writeUInt16BE(10, 22);
    return b;
  };
  const data = deflateSync(Buffer.from([0, 0, 255, 0, 255])),
    sequence = Buffer.alloc(4);
  sequence.writeUInt32BE(2);
  const animated = (packed) =>
    Buffer.concat([
      signature,
      base.subarray(8, 33),
      chunk("acTL", control),
      chunk("fcTL", frame(0)),
      base.subarray(33, -12),
      chunk("fcTL", frame(1)),
      chunk("fdAT", Buffer.concat([sequence, packed])),
      base.subarray(-12),
    ]);
  assert.equal(
    (
      await forge.request("attachments", {
        projectId: project.id,
        item: item(animated(data)),
      })
    ).status,
    200,
  );
  const corrupt = Buffer.from(data);
  corrupt[corrupt.length - 1] ^= 1;
  assert.equal(
    (
      await forge.request("attachments", {
        projectId: project.id,
        item: item(animated(corrupt)),
      })
    ).status,
    400,
    "a later animated frame cannot bypass compressed stream verification",
  );
});

test("source pixel/allocation limits reject compressed bombs before decode and retain the full 12 MB original budget", async (t) => {
  const forge = await isolatedForge(t);
  const project = await forge.json("projects/create", {
    name: "Original budgets",
  });
  const small = png();
  // A real, valid PNG ancillary text chunk pads the ORIGINAL, not its frame.
  const source = Buffer.concat([
    small.subarray(0, -12),
    chunk(
      "tEXt",
      Buffer.from("Comment\0" + "x".repeat(12_000_000 - small.length - 12 - 8)),
    ),
    small.subarray(-12),
  ]);
  assert.equal(source.length, 12_000_000);
  const saved = await forge.json("attachments", {
    projectId: project.id,
    item: {
      ...item(small),
      source: { data: source.toString("base64"), mimeType: "image/png" },
    },
  });
  const read = JSON.parse(
    await fs.readFile(
      path.join(forge.root, "data/attachments", project.id, saved.id + ".json"),
      "utf8",
    ),
  );
  assert.equal(read.source.data, source.toString("base64"));
  assert.equal(read.size, 12_000_000);
  for (const [width, height] of [
    [32769, 1],
    [1, 32769],
    [8000, 8000],
  ]) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 6;
    const bomb = Buffer.concat([
      signature,
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(Buffer.alloc(5))),
      chunk("IEND", Buffer.alloc(0)),
    ]);
    const response = await forge.request("attachments", {
      projectId: project.id,
      item: {
        ...item(small),
        source: { data: bomb.toString("base64"), mimeType: "image/png" },
      },
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Dimensi.*40 juta/i);
  }
});

test("valid oversized frames are rejected in upload and legacy read, but original source dimensions are separate", async (t) => {
  const forge = await isolatedForge(t);
  const project = await forge.json("projects/create", {
    name: "Dimension bounds",
  });
  const valid = await forge.json("attachments", {
    projectId: project.id,
    item: item(png()),
  });
  const file = path.join(
    forge.root,
    "data/attachments",
    project.id,
    valid.id + ".json",
  );
  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  for (const [width, height] of [
    [2001, 1],
    [1, 2001],
    [1601, 1600],
    [1600, 1601],
  ]) {
    const bytes = png(width, height);
    assert.equal(
      (
        await forge.request("attachments", {
          projectId: project.id,
          item: item(bytes),
        })
      ).status,
      400,
      `${width}x${height} must not be a normalized frame`,
    );
    await fs.writeFile(
      file,
      JSON.stringify({ ...saved, images: item(bytes).images }),
    );
    const preview = await forge.request(
      `attachments/image?projectId=${project.id}&id=${valid.id}`,
    );
    assert.equal(preview.status, 400);
    assert.match((await preview.json()).error, /1600.*unggah/i);
    const original = await forge.json("attachments", {
      projectId: project.id,
      item: {
        ...item(png()),
        source: { data: bytes.toString("base64"), mimeType: "image/png" },
      },
    });
    const read = JSON.parse(
      await fs.readFile(
        path.join(
          forge.root,
          "data/attachments",
          project.id,
          original.id + ".json",
        ),
        "utf8",
      ),
    );
    assert.equal(read.source.data, bytes.toString("base64"));
    assert.equal(read.size, bytes.length);
  }
});

test("frame encoded budget is 2900000, separate from 12 MB original", async (t) => {
  const forge = await isolatedForge(t);
  const project = await forge.json("projects/create", { name: "Byte budgets" });
  const small = png();
  const padded = Buffer.concat([
    small.subarray(0, -12),
    chunk("tEXt", Buffer.from("Comment\0" + "x".repeat(2_200_000))),
    small.subarray(-12),
  ]);
  assert.ok(
    padded.toString("base64").length > 2_900_000 &&
      padded.toString("base64").length < 3_000_000,
  );
  assert.equal(
    (
      await forge.request("attachments", {
        projectId: project.id,
        item: item(padded),
      })
    ).status,
    400,
  );
  const original = await forge.json("attachments", {
    projectId: project.id,
    item: {
      ...item(small),
      source: { data: padded.toString("base64"), mimeType: "image/png" },
    },
  });
  const file = path.join(
    forge.root,
    "data/attachments",
    project.id,
    original.id + ".json",
  );
  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(saved.source.data, padded.toString("base64"));
  await fs.writeFile(
    file,
    JSON.stringify({ ...saved, images: item(padded).images }),
  );
  assert.equal(
    (
      await forge.request(
        `attachments/image?projectId=${project.id}&id=${original.id}`,
      )
    ).status,
    400,
  );
});
