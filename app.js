import express from "express";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// OAuth callback
app.get("/callback", (req, res) => {
  res.redirect("/?code=" + req.query.code);
});

// Exchange code for access token
app.post("/exchange", async (req, res) => {
  // ENSURE we ALWAYS return JSON, never HTML
  res.setHeader('Content-Type', 'application/json');
  
  try {
    const { code } = req.body;
    
    if (!code) {
      return res.status(400).send(JSON.stringify({ error: "Missing authorization code" }));
    }

    const params = new URLSearchParams();
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("redirect_uri", "https://cloudinary-2w50.onrender.com/callback");
    params.append("client_id", "mcp_client_Qr1NLTYTBYCOYW4h");
    params.append("client_secret", "Jx6xTdLwssnpROUP2vEJH87MpJ2tVbhi");
    params.append("code_verifier", "gYaIzhzrbl8A2oVjPajNZdnVDioMvYI29w9oKWOqMlY");

    console.log("=== EXCHANGE REQUEST ===");
    console.log("Code:", code.substring(0, 20) + "...");

    const tokenRes = await fetch("https://asset-management.mcp.cloudinary.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },
      body: params.toString()
    });

    const rawResponse = await tokenRes.text();
    
    console.log("=== CLOUDINARY RESPONSE ===");
    console.log("Status:", tokenRes.status);
    console.log("Content-Type:", tokenRes.headers.get('content-type'));
    console.log("Raw response (first 500 chars):", rawResponse.substring(0, 500));

    // Check if HTML
    if (rawResponse.trim().startsWith("<")) {
      console.error("ERROR: Cloudinary returned HTML!");
      return res.status(502).send(JSON.stringify({ 
        error: "Cloudinary returned HTML instead of JSON",
        status: tokenRes.status,
        response_preview: rawResponse.substring(0, 200)
      }));
    }

    // Parse JSON
    let tokenData;
    try {
      tokenData = JSON.parse(rawResponse);
      console.log("Parsed token data:", JSON.stringify(tokenData, null, 2));
    } catch (parseErr) {
      console.error("ERROR: JSON parse failed:", parseErr.message);
      return res.status(502).send(JSON.stringify({ 
        error: "Failed to parse Cloudinary response",
        parse_error: parseErr.message,
        response_preview: rawResponse.substring(0, 200)
      }));
    }

    // Check for access token
    if (!tokenData.access_token) {
      console.error("ERROR: No access_token in response");
      return res.status(400).send(JSON.stringify({ 
        error: "No access_token in Cloudinary response",
        cloudinary_response: tokenData
      }));
    }

    // SUCCESS
    console.log("SUCCESS: Access token received:", tokenData.access_token.substring(0, 20) + "...");
    return res.status(200).send(JSON.stringify({
      access_token: tokenData.access_token,
      token_type: tokenData.token_type,
      expires_in: tokenData.expires_in,
      scope: tokenData.scope
    }));

  } catch (err) {
    console.error("=== FATAL ERROR ===");
    console.error(err);
    return res.status(500).send(JSON.stringify({ 
      error: "Server error",
      message: err.message,
      stack: err.stack
    }));
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));
