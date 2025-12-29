import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import https from "https";
import zlib from "zlib";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

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

// Helper for robust HTTPS requests
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
          } catch (_) {}
          resolve({
            status: resp.statusCode || 0,
            headers: resp.headers,
            text: buf.toString("utf8"),
          });
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// Exchange code for access token - RETURNS TOKEN ONLY
app.post("/exchange", async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: "Missing authorization code" });

    const params = new URLSearchParams();
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("redirect_uri", "https://cloudinary-2w50.onrender.com/callback");
    params.append("client_id", "mcp_client_Qr1NLTYTBYCOYW4h");
    params.append("client_secret", "Jx6xTdLwssnpROUP2vEJH87MpJ2tVbhi");
    params.append("code_verifier", "gYaIzhzrbl8A2oVjPajNZdnVDioMvYI29w9oKWOqMlY");

    const body = params.toString();

    // 1. Fetch Access Token
    const tokenResp = await httpRequest("https://asset-management.mcp.cloudinary.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0",
        "Content-Length": Buffer.byteLength(body)
      },
      body
    });

    // Handle token errors
    if (tokenResp.status >= 400 || tokenResp.text.trim().startsWith("<")) {
       return res.status(tokenResp.status).json({
         error: "Token exchange failed",
         status: tokenResp.status,
         raw_response: tokenResp.text.substring(0, 500)
       });
    }

    let tokenData;
    try {
      tokenData = JSON.parse(tokenResp.text);
    } catch (e) {
      return res.status(502).json({ error: "Invalid JSON from token endpoint", raw: tokenResp.text });
    }

    // 2. SUCCESS: Return the token immediately
    // Do NOT call folders API here anymore
    res.json({
      success: true,
      access_token: tokenData.access_token,
      expires_in: tokenData.expires_in,
      scope: tokenData.scope,
      token_type: tokenData.token_type,
      // refresh_token: tokenData.refresh_token // Optional: include if needed
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Running on port", PORT));
