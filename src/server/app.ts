import express from "express";
import axios from "axios";
import cors from "cors";

const app = express();
const DOMAIN_URL = "https://online.anyflip.com";
const SANITISE_PATTERN = /anyflip\.com\/([\w.-]+)\/([\w.-]+)/i;

app.use(cors());
app.use(express.json());

// API Route: Get Metadata
app.get("/api/metadata", async (req, res) => {
    const { url: rawUrl } = req.query;

    if (!rawUrl || typeof rawUrl !== "string") {
      return res.status(400).json({ error: "URL is required" });
    }

    const url = rawUrl.trim();

    try {
      let match = url.match(SANITISE_PATTERN);
      if (!match) {
        match = url.match(/anyflip\.com\/([\w.-]+)\/([\w.-]+)/i);
        if (!match) {
           throw new Error("Invalid AnyFlip URL format. Please provide a URL like: https://anyflip.com/user/book/");
        }
      }

      const userPath = `/${match[1]}/${match[2]}/`;
      const configJsUrl = `${DOMAIN_URL}${userPath}mobile/javascript/config.js`;

      const response = await axios.get(configJsUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Referer": url
        }
      });
      const jsText = response.data.trim();

      const start = jsText.indexOf("{");
      const end = jsText.lastIndexOf("}") + 1;

      if (start === -1 || end === 0) {
        throw new Error("Could not find configuration in AnyFlip source. The book's source code might have changed.");
      }

      const objStr = jsText.substring(start, end);
      let config;
      try {
        config = JSON.parse(objStr);
      } catch (e) {
        try {
          config = (new Function(`return ${objStr}`))();
        } catch (evalError) {
          throw new Error("Failed to parse book configuration from AnyFlip.");
        }
      }

      if (!config) throw new Error("Parsed config is empty.");

      let title = config.meta?.title || config.title;
      if (!title && config.bookConfig) {
        title = config.bookConfig.bookTitle;
      }
      const safeTitle = String(title || "AnyFlip_Book").replace(/[<>:"/\\|?*]/g, "").trim();

      let pageCount = config.totalPageCount || config.pageCount;
      if (pageCount === undefined && config.bookConfig) {
        pageCount = config.bookConfig.totalPageCount || config.bookConfig.pageCount;
      }
      if (pageCount === undefined && config.fliphtml5_pages) {
        pageCount = config.fliphtml5_pages.length;
      }

      const count = parseInt(String(pageCount));
      if (isNaN(count) || count <= 0) {
        throw new Error("Could not determine page count from document source.");
      }

      const pageUrls: string[] = [];
      const userPathClean = userPath.startsWith('/') ? userPath.substring(1) : userPath;
      const pagesList = config.fliphtml5_pages || [];

      for (let i = 0; i < count; i++) {
        let downloadPath = "";
        if (i < pagesList.length) {
          const pageData = pagesList[i];
          const rawFilenames = pageData.n || [];
          if (rawFilenames.length > 0) {
            downloadPath = rawFilenames[0].replace(/\\/g, "").replace(/\.\.\//g, "");
          }
        }

        if (!downloadPath) {
          downloadPath = `files/large/${i + 1}.webp`;
        } else {
          if (!downloadPath.startsWith("files/large/") && !downloadPath.startsWith("files/mobile/")) {
            if (downloadPath.startsWith("large/")) {
              downloadPath = `files/${downloadPath}`;
            } else {
              downloadPath = `files/large/${downloadPath}`;
            }
          }
        }

        pageUrls.push(`${DOMAIN_URL}/${userPathClean}${downloadPath}`);
      }

      res.json({
        title: safeTitle,
        pageCount: count,
        pageUrls,
      });
    } catch (error: any) {
      console.error("Metadata Error:", error.message);
      res.status(500).json({ error: error.message });
    }
});

// Proxy endpoint to fetch images (to avoid CORS)
app.get("/api/proxy-image", async (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== "string") {
      return res.status(400).send("URL required");
    }

    try {
      let referer = "https://www.anyflip.com/";
      try {
        const parsedUrl = new URL(url);
        if (url.includes("anyflip.com")) {
          const onlineMatch = url.match(/online\.anyflip\.com\/([^/]+)\/([^/]+)/);
          if (onlineMatch) {
            referer = `https://online.anyflip.com/${onlineMatch[1]}/${onlineMatch[2]}/`;
          } else {
            referer = "https://online.anyflip.com/";
          }
        } else {
          referer = `${parsedUrl.protocol}//${parsedUrl.host}/`;
        }
      } catch (e) {}

      const response = await axios.get(url, { 
        responseType: "arraybuffer",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Referer": referer,
          "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache"
        },
        timeout: 15000
      });
      const contentType = response.headers["content-type"];
      if (typeof contentType === "string") {
        res.setHeader("Content-Type", contentType);
      } else {
        res.setHeader("Content-Type", "image/webp");
      }
      res.send(response.data);
    } catch (error: any) {
      console.error(`Proxy Error for ${url}:`, error.message);
      res.status(500).send(`Proxy error: ${error.message}`);
    }
});

export default app;
