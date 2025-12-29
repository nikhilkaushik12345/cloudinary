import express from "express";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

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

// Exchange code for access token - FIXED VERSION
app.post("/exchange", async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: "Missing authorization code in request body." });
    }

    const params = new URLSearchParams();
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("redirect_uri", "https://cloudinary-2w50.onrender.com/callback");
    params.append("client_id", "mcp_client_Qr1NLTYTBYCOYW4h");
    params.append("client_secret", "Jx6xTdLwssnpROUP2vEJH87MpJ2tVbhi");
    params.append("code_verifier", "gYaIzhzrbl8A2oVjPajNZdnVDioMvYI29w9oKWOqMlY");

    console.log("Token request body:", params.toString()); // Debug log

    // Fetch token from Cloudinary - FIXED: Check status and handle errors properly
    const tokenRes = await fetch("https://asset-management.mcp.cloudinary.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },
      body: params.toString()
    });

    // CRITICAL FIX: Check if response is ok BEFORE parsing
    if (!tokenRes.ok) {
      const errorText = await tokenRes.text();
      console.log("Token endpoint error status:", tokenRes.status, "response:", errorText);
      return res.status(tokenRes.status).json({ 
        error: "Token exchange failed", 
        status: tokenRes.status, 
        response: errorText 
      });
    }

    const tokenData = await tokenRes.json();
    console.log("Token response:", tokenData); // Debug log

    if (!tokenData.access_token) {
      return res.status(400).json({ error: "No access token received", token_response: tokenData });
    }

    // Example API call using access token
    const folderRes = await fetch("https://asset-management.mcp.cloudinary.com/v1/folders", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${tokenData.access_token}`,
        "Accept": "application/json"
      }
    });

    if (!folderRes.ok) {
      const folderError = await folderRes.text();
      return res.status(400).json({ 
        error: "Folders API failed", 
        status: folderRes.status, 
        token_received: true,
        response: folderError 
      });
    }

    const folderData = await folderRes.json();
    res.json(folderData);

  } catch (err) {
    console.error("Exchange endpoint error:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Running on port", PORT));
