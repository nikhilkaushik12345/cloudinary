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

// --- Helper: Generic MCP Tool Runner ---
// Connects to SSE, performs handshake, runs a SPECIFIC tool, and returns result.
async function runMcpTool(accessToken, toolName, toolArgs) {
  return new Promise((resolve, reject) => {
    const sseUrl = "https://asset-management.mcp.cloudinary.com/sse";
    let handshakeStarted = false;
    let sseReq;
    let toolResolved = false;
    let buffer = "";

    // 1. Open SSE Connection
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
             
             // STAGE 1: Find Endpoint & Initialize
             if (!handshakeStarted) {
                 if (dataStr.startsWith("/")) {
                   handshakeStarted = true;
                   const postEndpoint = `https://asset-management.mcp.cloudinary.com${dataStr}`;
                   
                   try {
                     await triggerToolCall(postEndpoint, accessToken, toolName, toolArgs);
                   } catch (e) {
                     reject(e);
                     sseReq.destroy();
                   }
                 }
             } 
             // STAGE 2: Listen for Tool Result (ID: 2)
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
    // Timeout safety
    setTimeout(() => { 
        if (!toolResolved) { 
            sseReq.destroy(); 
            reject(new Error(`Timeout waiting for tool ${toolName}`)); 
        }
    }, 20000); 
    sseReq.end();
  });
}

// Helper: Fire handshake + Tool Call
async function triggerToolCall(endpoint, token, toolName, args) {
  const headers = { "Content-Type": "application/json", "Authorization": `Bearer ${token}` };

  // 1. Initialize
  const initBody = JSON.stringify({
    jsonrpc: "2.0", method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "cleanup-client", version: "1.0" } },
    id: 1
  });
  await httpRequest(endpoint, { method: "POST", headers, body: initBody });

  // 2. Initialized Notification
  await httpRequest(endpoint, { 
    method: "POST", headers, 
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) 
  });

  // 3. Execute Tool (ID: 2)
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

// OAuth: Exchange Code for Token
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

// MAIN: Cleanup Folders Endpoint
app.post("/cleanup-folders", async (req, res) => {
  const { access_token } = req.body;
  if (!access_token) return res.status(400).json({ error: "Missing access_token" });

  try {
    // --- Step 1: Search for Folders ---
    console.log("Starting Cleanup: Searching folders...");
    const searchResult = await runMcpTool(access_token, "search-folders", {
      sort_by: [],
      max_results: 50,
      next_cursor: ""
    });

    let folders = [];
    let searchRaw = "";
    
    // MCP tool returns text content, often as JSON string
    if (searchResult && searchResult.content && searchResult.content[0]) {
        searchRaw = searchResult.content[0].text;
        try {
            const parsed = JSON.parse(searchRaw);
            folders = parsed.folders || [];
        } catch (e) {
            console.error("Parse Error for Search Result:", e);
            // Fallback: If not JSON, maybe just log it
        }
    }

    if (folders.length === 0) {
      return res.json({ 
        message: "No folders found to delete.", 
        folders_found: [], 
        deletion_report: [] 
      });
    }

    const folderNames = folders.map(f => f.path);
    console.log(`Found ${folderNames.length} folders to delete:`, folderNames);

    // --- Step 2: Delete Each Folder ---
    const deletionResults = [];
    
    for (const folderName of folderNames) {
      try {
        console.log(`Deleting: ${folderName}`);
        
        // Call delete-folder tool
        const delRes = await runMcpTool(access_token, "delete-folder", { folder: folderName });
        
        // Extract status message
        const statusText = delRes.content && delRes.content[0] ? delRes.content[0].text : "Done";
        
        deletionResults.push({ 
          folder: folderName, 
          status: "Success", 
          details: statusText 
        });
        
        // Small delay to be polite to the server
        await new Promise(r => setTimeout(r, 500));

      } catch (err) {
        console.error(`Failed to delete ${folderName}:`, err.message);
        deletionResults.push({ 
          folder: folderName, 
          status: "Failed", 
          error: err.message 
        });
      }
    }

    // --- Step 3: Return Final Report ---
    res.json({
      folders_found: folders,
      deletion_report: deletionResults
    });

  } catch (err) {
    console.error("Cleanup Fatal Error:", err);
    res.status(500).json({ error: "Cleanup sequence failed", details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Running on port", PORT));
