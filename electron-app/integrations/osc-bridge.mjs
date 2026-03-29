import dgram from "node:dgram";

function padBuffer(buffer) {
  const padding = (4 - (buffer.length % 4)) % 4;
  if (padding === 0) {
    return buffer;
  }
  return Buffer.concat([buffer, Buffer.alloc(padding)]);
}

function encodeOscString(value) {
  return padBuffer(Buffer.from(`${String(value)}\0`, "utf8"));
}

function encodeOscArgument(value) {
  if (Number.isInteger(value)) {
    const payload = Buffer.alloc(4);
    payload.writeInt32BE(value, 0);
    return { tag: "i", payload };
  }
  if (typeof value === "number") {
    const payload = Buffer.alloc(4);
    payload.writeFloatBE(value, 0);
    return { tag: "f", payload };
  }
  if (typeof value === "boolean") {
    return { tag: value ? "T" : "F", payload: null };
  }
  return { tag: "s", payload: encodeOscString(String(value)) };
}

export function buildOscMessage(address, args = []) {
  const encodedArgs = args.map(encodeOscArgument);
  const typeTags = encodeOscString(`,${encodedArgs.map((entry) => entry.tag).join("")}`);
  const payload = encodedArgs
    .filter((entry) => entry.payload)
    .map((entry) => entry.payload);

  return Buffer.concat([encodeOscString(address), typeTags, ...payload]);
}

export async function sendOscMessage({ host, port, address, args = [] }) {
  const packet = buildOscMessage(address, args);
  const socket = dgram.createSocket("udp4");

  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.send(packet, port, host, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  }).finally(() => {
    socket.close();
  });

  return {
    ok: true,
    host,
    port,
    address,
    argCount: args.length,
    bytes: packet.length,
  };
}

export async function sendOscSnapshot({
  host = "127.0.0.1",
  port = 9000,
  addressPrefix = "/beatport-suite",
  summary = {},
  tracks = [],
}) {
  const sent = [];

  sent.push(
    await sendOscMessage({
      host,
      port,
      address: `${addressPrefix}/summary`,
      args: [
        Number(summary.count || 0),
        Number(summary.avgEnergy || 0),
        Number(summary.avgDanceability || 0),
        Number(summary.avgIntensity || 0),
      ],
    })
  );

  for (const [index, track] of tracks.slice(0, 8).entries()) {
    sent.push(
      await sendOscMessage({
        host,
        port,
        address: `${addressPrefix}/track`,
        args: [
          index + 1,
          track.title ?? "",
          track.artist ?? "",
          Number(track.bpm || 0),
          Number(track.intensity || 0),
          track.stage ?? "",
        ],
      })
    );
  }

  return {
    ok: true,
    sentMessages: sent.length,
    host,
    port,
    addressPrefix,
  };
}
