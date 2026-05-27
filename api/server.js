import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverEntry = await import(join(__dirname, "../dist/server/server.js"));
const handler = serverEntry.default?.default ?? serverEntry.default;

export default async function (req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const webReq = new Request(url, {
    method: req.method,
    headers: req.headers,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : req,
    duplex: "half",
  });

  let webRes;
  try {
    webRes = await handler.fetch(webReq);
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.end("Internal Server Error");
    return;
  }

  res.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => res.setHeader(key, value));
  const body = await webRes.arrayBuffer();
  res.end(Buffer.from(body));
}
