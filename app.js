import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import https from "https";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      protocol: u.protocol, hostname: u.hostname, port: u.port || 443,
      path: u.pathname + u.search, method: options.method || "GET", headers: options.headers || {},
    }, (resp) => {
      const chunks = [];
      resp.on("data", (d) => chunks.push(d));
      resp.on("end", () => resolve({ status: resp.statusCode, headers: resp.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function runMcpTool(accessToken, toolName, toolArgs) {
  return new Promise((resolve, reject) => {
    const sseUrl = "https://asset-management.mcp.cloudinary.com/sse";
    let handshakeStarted = false, sseReq, toolResolved = false, buffer = "";

    sseReq = https.request(sseUrl, {
      method: "GET", headers: { "Authorization": `Bearer ${accessToken}`, "Accept": "text/event-stream", "Cache-Control": "no-cache" }
    }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`SSE Connect failed: ${res.statusCode}`));
      res.on("data", async (chunk) => {
        buffer += chunk.toString();
        let idx; while ((idx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.substring(0, idx).trim(); buffer = buffer.substring(idx + 1);
          if (line.startsWith("data:")) {
            const d = line.replace("data:", "").trim();
            if (!handshakeStarted && d.startsWith("/")) {
              handshakeStarted = true;
              const ep = `https://asset-management.mcp.cloudinary.com${d}`;
              const h = { "Content-Type": "application/json", "Authorization": `Bearer ${accessToken}` };
              try {
                await httpRequest(ep, { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } }, id: 1 }) });
                await httpRequest(ep, { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
                await httpRequest(ep, { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", method: "tools/call", params: { name: toolName, arguments: toolArgs }, id: 2 }) });
              } catch (e) { reject(e); sseReq.destroy(); }
            } else {
              try { const j = JSON.parse(d); if (j.id === 2) { resolve(j.error ? { error: j.error } : j.result); toolResolved = true; sseReq.destroy(); } } catch (e) {}
            }
          }
        }
      });
    });
    sseReq.on("error", (e) => { if (!toolResolved) reject(e); });
    setTimeout(() => { if (!toolResolved) { sseReq.destroy(); reject(new Error("Timeout")); } }, 20000);
    sseReq.end();
  });
}

app.get("/callback", (req, res) => res.redirect("/?code=" + req.query.code));

app.post("/exchange", async (req, res) => {
  try {
    const { code } = req.body;
    const params = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: "https://cloudinary-2w50.onrender.com/callback", client_id: "mcp_client_Qr1NLTYTBYCOYW4h", client_secret: "Jx6xTdLwssnpROUP2vEJH87MpJ2tVbhi", code_verifier: "gYaIzhzrbl8A2oVjPajNZdnVDioMvYI29w9oKWOqMlY" });
    const r = await httpRequest("https://asset-management.mcp.cloudinary.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" }, body: params.toString() });
    if (r.status >= 400 || r.body.startsWith("<")) return res.status(502).json({ error: "Token failed", raw: r.body });
    res.json(JSON.parse(r.body));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/list-tools", async (req, res) => {
  // Reusing generic tool runner logic but adapted for 'list'
  try {
     const result = await new Promise((resolve, reject) => {
        const sseUrl = "https://asset-management.mcp.cloudinary.com/sse";
        let handshakeStarted = false, sseReq, toolResolved = false, buffer = "";
        sseReq = https.request(sseUrl, { method: "GET", headers: { "Authorization": `Bearer ${req.body.access_token}`, "Accept": "text/event-stream" } }, (r) => {
             r.on("data", async (c) => {
                buffer += c.toString();
                let idx; while ((idx = buffer.indexOf("\n")) !== -1) {
                    const line = buffer.substring(0, idx).trim(); buffer = buffer.substring(idx+1);
                    if (line.startsWith("data:")) {
                        const d = line.replace("data:", "").trim();
                        if (!handshakeStarted && d.startsWith("/")) {
                            handshakeStarted = true;
                            const ep = `https://asset-management.mcp.cloudinary.com${d}`;
                             const h = { "Content-Type": "application/json", "Authorization": `Bearer ${req.body.access_token}` };
                             await httpRequest(ep, { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } }, id: 1 }) });
                             await httpRequest(ep, { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
                             await httpRequest(ep, { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 2 }) });
                        } else {
                            try { const j = JSON.parse(d); if (j.id === 2) { resolve(j.result); toolResolved = true; sseReq.destroy(); } } catch (e) {}
                        }
                    }
                }
             });
        });
        sseReq.end();
    });
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/cleanup-folders", async (req, res) => {
  try {
    const searchRes = await runMcpTool(req.body.access_token, "search-folders", { sort_by: [], max_results: 50 });
    let folders = [];
    try { folders = JSON.parse(searchRes.content[0].text).folders || []; } catch (e) {}
    
    const delResults = [];
    for (const f of folders) {
        try {
            const d = await runMcpTool(req.body.access_token, "delete-folder", { folder: f.path });
            delResults.push({ folder: f.path, status: "Success", details: d.content[0].text });
        } catch(e) { delResults.push({ folder: f.path, status: "Failed", error: e.message }); }
    }
    res.json({ folders_found: folders, deletion_report: delResults });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Running on port", PORT));
