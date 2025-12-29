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

// --- Helper: Standard HTTP Request ---
function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: options.method || "GET",
      headers: options.headers || {},
    }, (resp) => {
      const chunks = [];
      resp.on("data", (d) => chunks.push(d));
      resp.on("end", () => {
        const buf = Buffer.concat(chunks);
        resolve({
          status: resp.statusCode,
          headers: resp.headers,
          body: buf.toString("utf8")
        });
      });
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// --- Helper: Connect to MCP and List Tools ---
async function fetchMcpTools(accessToken) {
  return new Promise((resolve, reject) => {
    const sseUrl = "https://asset-management.mcp.cloudinary.com/sse";
    console.log("1. Starting SSE connection to:", sseUrl);

    let handshakeStarted = false; // Prevent multiple triggers

    const req = https.request(sseUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "text/event-stream",
        "Cache-Control": "no-cache",
        "User-Agent": "Mozilla/5.0 (compatible; CloudinaryMcpClient/1.0)"
      }
    }, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`SSE Connect failed with status: ${res.statusCode}`));
      }

      res.on("data", async (chunk) => {
        const text = chunk.toString();
        
        // Look for the endpoint event
        if (!handshakeStarted && text.includes("event: endpoint")) {
           const lines = text.split("\n");
           const dataLine = lines.find(l => l.startsWith("data:"));
           
           if (dataLine) {
             handshakeStarted = true; // Lock it so we don't try twice
             
             const uri = dataLine.replace("data:", "").trim();
             const postEndpoint = uri.startsWith("http") 
               ? uri 
               : `https://asset-management.mcp.cloudinary.com${uri}`;
             
             console.log("2. Found MCP Endpoint:", postEndpoint);
             
             // CRITICAL FIX: We perform the handshake *inside* the SSE callback
             // and ONLY destroy the connection AFTER we have the tools.
             try {
               const tools = await performMcpHandshake(postEndpoint, accessToken);
               resolve(tools); // Send data back to frontend
             } catch (e) {
               reject(e);
             } finally {
               console.log("7. Closing SSE connection.");
               req.destroy(); // NOW it is safe to close
             }
           }
        }
      });
    });
    
    req.on("error", (err) => {
        if (!handshakeStarted) reject(err);
    });
    
    req.end();
  });
}

async function performMcpHandshake(endpoint, token) {
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`
  };

  // Step A: Initialize
  console.log("3. Sending 'initialize'...");
  const initBody = JSON.stringify({
    jsonrpc: "2.0",
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0" }
    },
    id: 1
  });

  const initRes = await httpRequest(endpoint, { method: "POST", headers, body: initBody });
  
  if (initRes.status >= 400) {
      throw new Error(`Initialize failed: ${initRes.body}`);
  }

  // Step B: Send Initialized Notification
  console.log("4. Sending 'notifications/initialized'...");
  await httpRequest(endpoint, { 
    method: "POST", 
    headers, 
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) 
  });

  // Step C: List Tools
  console.log("5. Sending 'tools/list'...");
  const listBody = JSON.stringify({
    jsonrpc: "2.0",
    method: "tools/list",
    id: 2
  });

  const listRes = await httpRequest(endpoint, { method: "POST", headers, body: listBody });
  console.log("6. Tools received!");
  
  return JSON.parse(listRes.body);
}

// --- Routes ---

app.get("/callback", (req, res) => {
  res.redirect("/?code=" + req.query.code);
});

// Exchange code for access token
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

    if (tokenResp.status >= 400 || tokenResp.body.trim().startsWith("<")) {
       return res.status(502).json({
         error: "Token exchange failed",
         status: tokenResp.status,
         raw_response: tokenResp.body.substring(0, 500)
       });
    }

    const tokenData = JSON.parse(tokenResp.body);
    res.json({
      success: true,
      access_token: tokenData.access_token,
      expires_in: tokenData.expires_in,
      scope: tokenData.scope
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// New Endpoint: List Tools
app.post("/list-tools", async (req, res) => {
  const { access_token } = req.body;
  if (!access_token) return res.status(400).json({ error: "Missing access_token" });

  try {
    const result = await fetchMcpTools(access_token);
    res.json(result);
  } catch (err) {
    console.error("MCP Tool List Error:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Running on port", PORT));
