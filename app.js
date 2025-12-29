import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import https from "https";

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
    console.log("1. Starting SSE connection...");

    let handshakeStarted = false;
    let sseReq;
    let postEndpoint = null;
    let toolsResolved = false; // Flag to prevent multi-resolve

    let buffer = "";

    sseReq = https.request(sseUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "text/event-stream",
        "Cache-Control": "no-cache",
        "User-Agent": "Node-MCP-Client/1.0"
      }
    }, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`SSE Connect failed: ${res.statusCode}`));
      }

      res.on("data", async (chunk) => {
        buffer += chunk.toString();
        
        // Parse line-by-line
        let lineEnd;
        while ((lineEnd = buffer.indexOf("\n")) !== -1) {
          const line = buffer.substring(0, lineEnd).trim();
          buffer = buffer.substring(lineEnd + 1);

          if (line.startsWith("data:")) {
             const dataStr = line.replace("data:", "").trim();
             
             // --- STAGE 1: Find Endpoint ---
             if (!handshakeStarted) {
                 // First message is usually the endpoint URL
                 if (dataStr.startsWith("/")) {
                   handshakeStarted = true;
                   postEndpoint = `https://asset-management.mcp.cloudinary.com${dataStr}`;
                   console.log("2. Found Endpoint:", postEndpoint);
                   
                   try {
                     // Trigger the handshake requests (fire-and-forget)
                     await triggerHandshake(postEndpoint, accessToken);
                   } catch (e) {
                     reject(e);
                     sseReq.destroy();
                   }
                 }
             } 
             // --- STAGE 2: Listen for Tools List ---
             else {
                try {
                   // Attempt to parse every SSE message as JSON
                   const json = JSON.parse(dataStr);
                   
                   // Check if this matches our "tools/list" request ID (2)
                   if (json.id === 2) {
                       console.log("6. Tools received via SSE!");
                       
                       if (json.error) {
                           reject(new Error("MCP Error: " + JSON.stringify(json.error)));
                       } else {
                           resolve(json.result);
                       }
                       
                       toolsResolved = true;
                       sseReq.destroy(); // Done!
                   }
                } catch (e) {
                   // Ignore parsing errors (keep-alives, empty lines, etc.)
                }
             }
          }
        }
      });
    });
    
    sseReq.on("error", (err) => {
        if (!toolsResolved) reject(err);
    });
    
    // Safety timeout: If no tools in 10 seconds, abort
    setTimeout(() => {
        if (!toolsResolved) {
            sseReq.destroy();
            reject(new Error("Timeout: Tools list never arrived via SSE"));
        }
    }, 10000);

    sseReq.end();
  });
}

// Fire the handshake requests but do NOT wait for their results (since results come via SSE)
async function triggerHandshake(endpoint, token) {
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`
  };

  // Step A: Initialize
  console.log("3. Sending initialize...");
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
  await httpRequest(endpoint, { method: "POST", headers, body: initBody });

  // Step B: Initialized Notification
  console.log("4. Sending initialized notification...");
  await httpRequest(endpoint, { 
    method: "POST", 
    headers, 
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) 
  });

  // Step C: List Tools (Request ID: 2)
  console.log("5. Sending tools/list...");
  const listBody = JSON.stringify({
    jsonrpc: "2.0",
    method: "tools/list",
    id: 2
  });
  await httpRequest(endpoint, { method: "POST", headers, body: listBody });
  // We stop here. The result will appear on the SSE stream processed by fetchMcpTools
}

// --- Routes ---

app.get("/callback", (req, res) => {
  res.redirect("/?code=" + req.query.code);
});

app.post("/exchange", async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: "Missing code" });

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
       return res.status(502).json({ error: "Token exchange failed", raw: tokenResp.body.substring(0, 300) });
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

// Original POST endpoint
app.post("/list-tools", async (req, res) => {
  const { access_token } = req.body;
  if (!access_token) return res.status(400).json({ error: "Missing access_token" });

  try {
    const result = await fetchMcpTools(access_token);
    res.json(result);
  } catch (err) {
    console.error("MCP Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// NEW: GET Endpoint for easy testing
// Usage: /list-tools?token=YOUR_ACCESS_TOKEN
app.get("/list-tools", async (req, res) => {
  const access_token = req.query.token;
  if (!access_token) return res.status(400).json({ error: "Missing token query param" });

  try {
    const result = await fetchMcpTools(access_token);
    res.json(result);
  } catch (err) {
    console.error("MCP Error:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Running on port", PORT));
