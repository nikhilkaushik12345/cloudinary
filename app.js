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

// --- Helper: Generic MCP Tool Runner (SSE Logic) ---
async function runMcpTool(accessToken, toolName, toolArgs) {
  return new Promise((resolve, reject) => {
    const sseUrl = "https://asset-management.mcp.cloudinary.com/sse";
    let handshakeStarted = false;
    let sseReq;
    let toolResolved = false;
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
      if (res.statusCode !== 200) return reject(new Error(`SSE Connect failed: ${res.statusCode}`));

      res.on("data", async (chunk) => {
        buffer += chunk.toString();
        let lineEnd;
        while ((lineEnd = buffer.indexOf("\n")) !== -1) {
          const line = buffer.substring(0, lineEnd).trim();
          buffer = buffer.substring(lineEnd + 1);

          if (line.startsWith("data:")) {
             const dataStr = line.replace("data:", "").trim();
             
             // STAGE 1: Find Endpoint
             if (!handshakeStarted) {
                 if (dataStr.startsWith("/")) {
                   handshakeStarted = true;
                   const postEndpoint = `https://asset-management.mcp.cloudinary.com${dataStr}`;
                   
                   try {
                     // Trigger Handshake + Specific Tool Call
                     await triggerToolCall(postEndpoint, accessToken, toolName, toolArgs);
                   } catch (e) {
                     reject(e);
                     sseReq.destroy();
                   }
                 }
             } 
             // STAGE 2: Listen for Result (ID: 2)
             else {
                try {
                   const json = JSON.parse(dataStr);
                   if (json.id === 2) { 
                       if (json.error) reject(new Error(JSON.stringify(json.error)));
                       else resolve(json.result);
                       
                       toolResolved = true;
                       sseReq.destroy(); 
                   }
                } catch (e) { }
             }
          }
        }
      });
    });
    
    sseReq.on("error", (err) => { if (!toolResolved) reject(err); });
    setTimeout(() => { 
        if (!toolResolved) { 
            sseReq.destroy(); 
            reject(new Error("Timeout waiting for tool response")); 
        }
    }, 15000); // 15s timeout for tools
    sseReq.end();
  });
}

// Helper: Fire handshake + Specific Tool Call
async function triggerToolCall(endpoint, token, toolName, args) {
  const headers = { "Content-Type": "application/json", "Authorization": `Bearer ${token}` };

  // Handshake (Initialize)
  const initBody = JSON.stringify({
    jsonrpc: "2.0", method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test-client", version: "1.0" } },
    id: 1
  });
  await httpRequest(endpoint, { method: "POST", headers, body: initBody });

  // Handshake (Notification)
  await httpRequest(endpoint, { 
    method: "POST", headers, 
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) 
  });

  // Execute Specific Tool (ID: 2)
  const toolBody = JSON.stringify({
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      name: toolName,
      arguments: args
    },
    id: 2
  });
  await httpRequest(endpoint, { method: "POST", headers, body: toolBody });
}

// --- Routes ---

app.get("/callback", (req, res) => {
  res.redirect("/?code=" + req.query.code);
});

// 1. Exchange Code for Token
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
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json", "User-Agent": "Mozilla/5.0", "Content-Length": Buffer.byteLength(body) },
      body
    });

    if (tokenResp.status >= 400 || tokenResp.body.trim().startsWith("<")) {
       return res.status(502).json({ error: "Token exchange failed", raw: tokenResp.body.substring(0, 300) });
    }

    const tokenData = JSON.parse(tokenResp.body);
    res.json({ success: true, access_token: tokenData.access_token, expires_in: tokenData.expires_in, scope: tokenData.scope });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. List Tools (Just lists them, doesn't run cleanup)
app.post("/list-tools", async (req, res) => {
  const { access_token } = req.body;
  if (!access_token) return res.status(400).json({ error: "Missing access_token" });

  try {
    // We can reuse runMcpTool logic, but we need to trigger 'tools/list' instead of 'tools/call'
    // For simplicity, we'll keep the specialized fetchMcpTools logic here inline or reuse the generic one if adapted.
    // To match your exact request to "do this" (cleanup), this endpoint might not be the primary focus, 
    // but I'll leave it functional by calling the generic runner with a special 'list' flag or just re-implementing briefly.
    
    // Quick inline implementation reusing the generic structure but sending 'tools/list'
    const result = await new Promise((resolve, reject) => {
        const sseUrl = "https://asset-management.mcp.cloudinary.com/sse";
        let handshakeStarted = false;
        let sseReq;
        let toolResolved = false;
        let buffer = "";

        sseReq = https.request(sseUrl, { method: "GET", headers: { "Authorization": `Bearer ${access_token}`, "Accept": "text/event-stream" } }, (r) => {
             r.on("data", async (c) => {
                buffer += c.toString();
                let idx; while ((idx = buffer.indexOf("\n")) !== -1) {
                    const line = buffer.substring(0, idx).trim(); buffer = buffer.substring(idx+1);
                    if (line.startsWith("data:")) {
                        const d = line.replace("data:", "").trim();
                        if (!handshakeStarted && d.startsWith("/")) {
                            handshakeStarted = true;
                            const ep = `https://asset-management.mcp.cloudinary.com${d}`;
                            // Trigger List
                             const h = { "Content-Type": "application/json", "Authorization": `Bearer ${access_token}` };
                             const init = JSON.stringify({ jsonrpc: "2.0", method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } }, id: 1 });
                             await httpRequest(ep, { method: "POST", headers: h, body: init });
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. CLEANUP FOLDERS (The main task)
app.post("/cleanup-folders", async (req, res) => {
  const { access_token } = req.body;
  if (!access_token) return res.status(400).json({ error: "Missing access_token" });

  try {
    // A. Search for folders
    console.log("Step 1: Searching for folders...");
    const searchResult = await runMcpTool(access_token, "search-folders", {
      sort_by: [],
      max_results: 50,
      next_cursor: ""
    });

    // Handle tool output structure
    let folders = [];
    if (searchResult && searchResult.content && searchResult.content[0]) {
        try {
            const parsed = JSON.parse(searchResult.content[0].text);
            folders = parsed.folders || [];
        } catch (e) {
            console.error("Failed to parse search output:", searchResult.content[0].text);
        }
    }

    if (folders.length === 0) {
      return res.json({ message: "No folders found to delete.", raw_result: searchResult });
    }

    const folderNames = folders.map(f => f.path);
    console.log(`Step 2: Found ${folderNames.length} folders:`, folderNames);

    // B. Delete each folder
    const deletionResults = [];
    
    for (const folderName of folderNames) {
      try {
        console.log(`Deleting: ${folderName}`);
        const delRes = await runMcpTool(access_token, "delete-folder", { folder: folderName });
        const statusText = delRes.content && delRes.content[0] ? delRes.content[0].text : "Done";
        
        deletionResults.push({ folder: folderName, status: "Success", details: statusText });
      } catch (err) {
        deletionResults.push({ folder: folderName, status: "Failed", error: err.message });
      }
    }

    // C. Return Report
    res.json({
      folders_found: folders,
      deletion_report: deletionResults
    });

  } catch (err) {
    console.error("Cleanup Error:", err);
    res.status(500).json({ error: "Cleanup failed", details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Running on port", PORT));
