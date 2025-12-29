import express from "express";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

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

// Exchange code for access token - SIMPLIFIED TO FETCH ACCESS_TOKEN ONLY
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

    console.log("Token request body:", params.toString());

    // Fetch token from Cloudinary
    const tokenRes = await fetch("https://asset-management.mcp.cloudinary.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },
      body: params.toString()
    });

    // Get raw text FIRST to debug
    const rawResponse = await tokenRes.text();
    console.log("Raw token response:", rawResponse);
    console.log("Token response status:", tokenRes.status);

    // Check if it's HTML error page
    if (rawResponse.includes("<!DOCTYPE") || rawResponse.includes("<html")) {
      console.error("HTML error page received from Cloudinary:", rawResponse.substring(0, 200));
      return res.status(502).json({ 
        error: "Cloudinary returned HTML error page", 
        status: tokenRes.status,
        raw_response: rawResponse.substring(0, 500)
      });
    }

    // Parse JSON
    let tokenData;
    try {
      tokenData = JSON.parse(rawResponse);
    } catch (parseErr) {
      console.error("JSON parse error:", parseErr.message);
      return res.status(502).json({ 
        error: "Invalid JSON from Cloudinary", 
        raw_response: rawResponse.substring(0, 500)
      });
    }

    // Extract JUST the access token as requested
    if (!tokenData.access_token) {
      return res.status(400).json({ 
        error: "No access_token in response", 
        full_response: tokenData 
      });
    }

    // SUCCESS: Return ONLY the access token
    res.json({ 
      access_token: tokenData.access_token,
      token_type: tokenData.token_type,
      expires_in: tokenData.expires_in,
      scope: tokenData.scope
    });

  } catch (err) {
    console.error("Exchange endpoint error:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Running on port", PORT));
