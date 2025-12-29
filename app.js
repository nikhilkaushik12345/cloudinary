import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import https from "https";
import zlib from "zlib";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public"))); // serves index.html

// Only allow POST for /exchange
app.all("/exchange", (req, res, next) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed. Use POST with JSON body." });
  }
  next();
});

// OAuth callback
app.get("/callback", (req, res) => {
  res.redirect("/?code=" + req.query.code);
});

function httpRequest(url, { method = "GET", headers = {}, body = "" } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);

    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method,
        headers,
      },
      (resp) => {
        const chunks = [];
        resp.on("data", (d) => chunks.push(d));
        resp.on("end", () => {
          let buf = Buffer.concat(chunks);

          const enc = (resp.headers["content-encoding"] || "").toLowerCase();
          try {
            if (enc === "gzip") buf = zlib.gunzipSync(buf);
            else if (enc === "br") buf = zlib.brotliDecompressSync(buf);
            else if (enc === "deflate") buf = zlib.inflateSync(buf);
          } catch (_) {
            // If decompression fails, fall back to raw buffer
          }

          resolve({
            status: resp.statusCode || 0,
            headers
