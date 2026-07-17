import express from "express";
import cors from "cors";
import https from "https";
import fs from "fs";
import path from "path";
import os from "os";
import axios from "axios";
import * as cheerio from "cheerio";
import sizeOf from "image-size";
import { jsPDF } from "jspdf";
import pptxgen from "pptxgenjs";
import got from "got";

// Define a Response interface that is compatible with the Fetch API Response
interface FetchCompatibleResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<any>;
}

import { HttpsProxyAgent } from 'https-proxy-agent';

// Proxy configuration - Currently empty until working proxies are provided
const PROXY_LIST: string[] = [];

async function requestWithProxy(targetUrl: string, options: { headers?: Record<string, string>; timeout?: number; isBinary?: boolean } = {}): Promise<{ status: number; headers: any; body: any }> {
  const headers = {
    "User-Agent": options.headers?.["User-Agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Cache-Control": "max-age=0",
    ...options.headers,
  };

  const attemptRequest = async (proxyUrl: string | null): Promise<{ status: number; headers: any; body: any }> => {
    const gotOptions: any = {
      headers,
      timeout: {
        request: options.timeout || 15000
      },
      retry: {
        limit: 0 // We handle retries manually with proxy rotation
      },
      followRedirect: true,
      throwHttpErrors: false,
      responseType: options.isBinary ? 'buffer' : 'text',
      https: {
        rejectUnauthorized: !!proxyUrl // Only relax for proxies
      }
    };

    if (proxyUrl) {
      gotOptions.agent = {
        http: new HttpsProxyAgent(proxyUrl),
        https: new HttpsProxyAgent(proxyUrl)
      };
    }

    try {
      const response = await got(targetUrl, gotOptions) as any;
      return {
        status: response.statusCode,
        headers: response.headers,
        body: response.body
      };
    } catch (err: any) {
      // Try allorigins as a fallback if the direct request fails for html
      if (!options.isBinary) {
        try {
          console.log(`Direct request failed for ${targetUrl}, trying allorigins fallback...`);
          const response = await got(`https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, { ...gotOptions, agent: undefined });
          return {
            status: response.statusCode,
            headers: response.headers,
            body: response.body
          };
        } catch (proxyErr) {
          throw err; // throw original
        }
      }
      throw err;
    }
  };

  // Try direct, then proxies
  const attempts = [null, ...PROXY_LIST]; // null means direct

  for (const proxy of attempts) {
    try {
      return await attemptRequest(proxy);
    } catch (err: any) {
      console.warn(`Proxy attempt failed: ${proxy || 'direct'}, reason: ${err.message}, trying next...`);
    }
  }

  throw new Error("All proxy and direct connection attempts failed.");
}

async function fetchWithProxy(targetUrl: string, options: { headers?: Record<string, string>; signal?: any } = {}): Promise<FetchCompatibleResponse> {
  try {
    const res = await requestWithProxy(targetUrl, { headers: options.headers });
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      text: async () => typeof res.body === 'string' ? res.body : JSON.stringify(res.body),
      json: async () => typeof res.body === 'string' ? JSON.parse(res.body) : res.body
    };
  } catch (err: any) {
    console.error(`[Scraper] fetchWithProxy failed:`, err.message);
    throw err;
  }
}

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

      const response = await fetch(configJsUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Referer": url
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch AnyFlip configuration: HTTP ${response.status}`);
      }

      const jsTextRaw = await response.text();
      const jsText = jsTextRaw.trim();

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
app.get("/api/fetch-config", async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== "string") {
    return res.status(400).send("URL required");
  }
  
  try {
    let baseUrl = url.split('#')[0];
    if (!baseUrl.endsWith('/')) {
      baseUrl += '/';
    }

    const htmlResponse = await requestWithProxy(baseUrl);
    const html = typeof htmlResponse.body === 'string' ? htmlResponse.body : htmlResponse.body.toString('utf-8');
    const $ = cheerio.load(html);
    let title = $("title").text().trim() || "fliphtml5_document";

    const configUrl = `${baseUrl}javascript/config.js`;
    const configResponse = await requestWithProxy(configUrl);
    let configData = "";
    if (configResponse.status === 200) {
      configData = typeof configResponse.body === 'string' ? configResponse.body : configResponse.body.toString('utf-8');
    } else {
      console.warn(`FlipHTML5 config fetch returned status ${configResponse.status}`);
    }

    let encryptedString = "";
    let isEncrypted = false;
    let plainPages: any[] = [];
    let pageCount = 0;

    const encMatch = configData.match(/(?:htmlConfig(?:[.]bookConfig)?\s*=\s*["'])([^"']{100,})(?:["'])/);
    if (encMatch) {
      encryptedString = encMatch[1];
      isEncrypted = true;
    } else {
      const plainMatch = configData.match(/fliphtml5_pages\s*=\s*(\[.*?\]);/s);
      if (plainMatch) {
        try {
          plainPages = JSON.parse(plainMatch[1].replace(/'/g, '"'));
        } catch (e) {
          console.warn("Failed to parse plain pages", e);
        }
      }
    }

    const countMatch = configData.match(/["']?(?:pageCount|totalPageCount|pagesCount)["']?\s*:\s*(\d+)/i);
    if (countMatch) {
      pageCount = parseInt(countMatch[1], 10);
    } else {
      const htmlCountMatch = html.match(/["']?(?:pageCount|totalPageCount|pagesCount)["']?\s*:\s*(\d+)/i);
      if (htmlCountMatch) {
        pageCount = parseInt(htmlCountMatch[1], 10);
      }
    }

    res.json({ title, encryptedString, isEncrypted, plainPages, pageCount, baseUrl });
  } catch (error: any) {
    console.error("FlipHTML5 config fetch error:", error);
    res.status(500).json({ error: "Failed to fetch FlipHTML5 configuration" });
  }
});

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
        } else if (url.includes("fliphtml5.com")) {
          referer = "https://fliphtml5.com/";
        } else if (url.includes("slidesharecdn.com") || url.includes("slideshare.net")) {
          referer = "https://www.slideshare.net/";
        } else if (url.includes("scribdassets.com") || url.includes("scribd.com")) {
          referer = "https://www.scribd.com/";
        } else {
          referer = `${parsedUrl.protocol}//${parsedUrl.host}/`;
        }
      } catch (e) {}

      const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
      const response = await requestWithProxy(url, {
        isBinary: true,
        headers: {
          "User-Agent": userAgent,
          "Referer": referer,
          "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache",
        }
      });

      if (response.status >= 400) {
        throw new Error(`Upstream server returned HTTP ${response.status}`);
      }

      const contentType = response.headers["content-type"];
      if (contentType) {
        res.setHeader("Content-Type", contentType);
      } else {
        res.setHeader("Content-Type", "image/webp");
      }

      res.send(Buffer.from(response.body));
    } catch (error: any) {
      console.error(`Proxy Error for ${url}:`, error.message);
      res.status(500).send(`Proxy error: ${error.message}`);
    }
});

const scrapeAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 64,
});

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0"
];

interface PatternInfo {
  pattern: string;
  isScribd: boolean;
  hasQuery: boolean;
  matchedSubfolder?: string;
  matchedResolution?: string;
  matchedExtension?: string;
}

function findSlideUrlPattern(url: string): PatternInfo {
  let isScribd = url.includes("scribdassets.com") || url.includes("scribd.com");
  let pattern = url;
  
  if (isScribd) {
    if (url.includes("/images/pages-")) {
      pattern = url.replace(/\/images\/pages-\d+\.(jpg|webp|png)/i, "/images/pages-{page}.$1");
      return { pattern, isScribd: true, hasQuery: url.includes("?") };
    } else if (url.includes("/images/page-")) {
      pattern = url.replace(/\/images\/page-\d+\.(jpg|webp|png)/i, "/images/page-{page}.$1");
      return { pattern, isScribd: true, hasQuery: url.includes("?") };
    }
  }
  
  const isSlideShare = url.includes("slidesharecdn.com") || url.includes("slideshare.net");
  if (isSlideShare) {
    const slideShareRegex = /(\/(\d+)\/.*?)-(\d+)-(\d+)\.(jpg|webp|png|jpeg)/i;
    const match = url.match(slideShareRegex);
    if (match) {
      const subfolder = match[2];
      const pageNum = match[3];
      const resolution = match[4];
      const ext = match[5];
      pattern = url.replace(
        new RegExp(`\\/${subfolder}\\/(.*?)-${pageNum}-${resolution}\\.(jpg|webp|png|jpeg)`, 'i'),
        `/{subfolder}/$1-{page}-{resolution}.$2`
      );
      return { 
        pattern, 
        isScribd: false, 
        hasQuery: url.includes("?"),
        matchedSubfolder: subfolder,
        matchedResolution: resolution,
        matchedExtension: ext
      };
    }
  }
  
  const digitRegex = /[-_](\d+)\.(jpg|webp|png|jpeg)/i;
  const digitMatch = url.match(digitRegex);
  if (digitMatch) {
    pattern = url.replace(digitRegex, `-{page}.$2`);
    return { pattern, isScribd, hasQuery: url.includes("?") };
  }
  
  return { pattern: url, isScribd, hasQuery: url.includes("?") };
}

async function probeSlideUrl(imgUrl: string, userAgent: string): Promise<boolean> {
  try {
    const res = await requestWithProxy(imgUrl, {
      timeout: 3000,
      headers: {
        "User-Agent": userAgent,
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Range": "bytes=0-100"
      }
    });
    const contentType = res.headers['content-type'] || '';
    return res.status >= 200 && res.status < 400 && (contentType.startsWith('image/') || false);
  } catch (err) {
    try {
      const res2 = await requestWithProxy(imgUrl, {
        timeout: 2000,
        headers: {
          "User-Agent": userAgent,
          "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
        }
      });
      const contentType = res2.headers['content-type'] || '';
      return res2.status >= 200 && res2.status < 400 && (contentType.startsWith('image/') || false);
    } catch (e) {
      return false;
    }
  }
}

app.get("/api/scrape", async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "SlideShare URL is required" });
  }

  const trimmedUrl = url.trim();
  let cleanUrl = trimmedUrl.replace(/\/mobile\//, '/');
  
  // Handle /slideshow/ URLs - if they fail, maybe try standard format
  if (cleanUrl.includes("/slideshow/")) {
    console.log("Detected /slideshow/ URL, attempting to normalize...");
  }
  
  if (!cleanUrl.includes("slideshare") && !cleanUrl.includes("scribd")) {
    return res.status(400).json({ error: "Please enter a valid SlideShare or Scribd presentation URL" });
  }

  try {
    const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    console.log(`Processing SlideShare/Scribd URL: ${cleanUrl}`);
    let html = "";
    let title = "";
    let slideCount = 0;
    let isOembedSuccess = false;

    if (cleanUrl.includes("slideshare")) {
      try {
        console.log("Attempting oEmbed API for SlideShare...");
        const oembedUrl = `https://www.slideshare.net/api/oembed/2?url=${encodeURIComponent(cleanUrl)}&format=json`;
        const oembedResponse = await fetchWithProxy(oembedUrl, {
          headers: { "User-Agent": userAgent },
          signal: AbortSignal.timeout(6000),
        });

        if (oembedResponse.ok) {
          const responseText = await oembedResponse.text();
          let oembedData;
          if (responseText.trim().startsWith('<')) {
            console.log("Response is HTML, skipping JSON parse");
          } else {
            try {
              oembedData = JSON.parse(responseText);
            } catch (e) {
              console.error("Failed to parse oEmbed JSON:", e);
            }
          }

          if (oembedData && oembedData.slide_image_baseurl && oembedData.slide_image_baseurl_suffix) {
            console.log("Found direct image pattern from oEmbed API");
            const pattern = oembedData.slide_image_baseurl.replace(/\/95\//, '/{subfolder}/') + "{page}" + oembedData.slide_image_baseurl_suffix.replace(/-1024\.jpg/i, '-{resolution}.jpg');
            return res.json({
              title: oembedData.title || "SlideShare Presentation",
              slideCount: oembedData.total_slides ? parseInt(oembedData.total_slides, 10) : 100,
              pattern: pattern,
              isScribd: false,
              resolvedSubfolder: "95",
              resolvedResolution: "1024",
              resolutionLabel: "HD (1024px)",
              previewUrl: oembedData.slide_image_baseurl + "1" + oembedData.slide_image_baseurl_suffix
            });
          }

          if (oembedData && oembedData.html) {
            title = oembedData.title || "";
            if (oembedData.total_slides) {
              slideCount = parseInt(oembedData.total_slides, 10);
            }
            
            const $embed = cheerio.load(oembedData.html);
            const iframeSrc = $embed("iframe").attr("src");
            if (iframeSrc) {
              const embedUrl = iframeSrc.startsWith("//") ? "https:" + iframeSrc : iframeSrc;
              console.log("Fetching SlideShare embed page:", embedUrl);
              const embedResponse = await fetchWithProxy(embedUrl, {
                headers: {
                  "User-Agent": userAgent,
                  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                  "Accept-Language": "en-US,en;q=0.9",
                },
                signal: AbortSignal.timeout(10000),
              });
              if (embedResponse.ok) {
                html = await embedResponse.text();
                isOembedSuccess = true;
              }
            }
          }
        }
      } catch (oembedErr: any) {
        console.error("SlideShare oEmbed/Embed Fetch failed:", oembedErr.message);
      }
    }

    if (!isOembedSuccess) {
      console.log("Using direct page scrape...");
      const response = await fetchWithProxy(cleanUrl, {
        headers: {
          "User-Agent": userAgent,
          "Referer": "https://www.google.com/",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9,en;q=0.8",
          "Accept-Encoding": "gzip, deflate, br",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "Upgrade-Insecure-Requests": "1",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "Sec-Fetch-User": "?1",
        },
        signal: AbortSignal.timeout(10000),
      });
      
      html = await response.text();
    }

    const $ = cheerio.load(html);

    if (!title) {
      title = $("h1").first().text().trim() || 
              $("meta[property='og:title']").attr("content") || 
              $("meta[name='twitter:title']").attr("content") ||
              $("title").text().trim() ||
              "SlideShare Presentation";
    }

    title = title.replace(/[<>:"/\\|?*]/g, "").trim();

    if (title === "Page no longer exists") {
      throw new Error("This presentation no longer exists on SlideShare.");
    }

    if (slideCount <= 0) {
      const countAttr = $("meta[name='slideshare:slide_count']").attr("content") || 
                        $("[itemprop='numberOfPages']").attr("content") ||
                        $("[itemprop='numberOfPages']").text().trim();
      
      if (countAttr) {
        slideCount = parseInt(countAttr, 10);
      }
    }

    const foundUrls: string[] = [];
    
    // First, try extracting from DOM
    $("script, link, meta, img, source").each((_, el) => {
      const scriptContent = $(el).html();
      if (scriptContent) {
        const regex = /https:\/\/[^"'\s<>]+\.(slidesharecdn|scribdassets)\.com\/[^"'\s<>]+/gi;
        let m;
        while ((m = regex.exec(scriptContent)) !== null) {
          foundUrls.push(m[0]);
        }
      }
      
      const src = $(el).attr("src") || 
                  $(el).attr("srcset") || 
                  $(el).attr("data-src") || 
                  $(el).attr("data-normal") || 
                  $(el).attr("data-full") || 
                  $(el).attr("data-srcset") ||
                  $(el).attr("data-lazy-src") ||
                  $(el).attr("content");
      if (src) {
        const parts = src.split(",");
        for (const part of parts) {
          const cleanUrl = part.trim().split(" ")[0];
          if (cleanUrl && (cleanUrl.includes("slidesharecdn.com") || cleanUrl.includes("scribdassets.com") || cleanUrl.includes("scribd.com") || cleanUrl.includes("slideshare.net"))) {
            foundUrls.push(cleanUrl);
          }
        }
      }
    });

    // Fallback: raw HTML regex scan
    if (foundUrls.length === 0) {
      console.log("DOM scan failed, trying raw HTML regex scan...");
      const cdnRegex = /https:\/\/[^"'\s<>]+?\.(slidesharecdn|scribdassets)\.com\/[^"'\s<>]+\.(jpg|jpeg|png|webp)[^"'\s<>]*/gi;
      let m;
      while ((m = cdnRegex.exec(html)) !== null) {
        foundUrls.push(m[0]);
      }
    }

    if (foundUrls.length === 0) {
      console.log("Raw HTML scan failed, trying final image tag scan...");
      $("img, source, meta").each((_, el) => {
        const src = $(el).attr("src") || 
                    $(el).attr("data-src") || 
                    $(el).attr("data-full") || 
                    $(el).attr("content");
        
        if (src && (src.includes("slidesharecdn.com") || src.includes("scribdassets.com") || src.includes("slideshare.net"))) {
          foundUrls.push(src);
        }
      });
    }

    if (foundUrls.length === 0) {
      console.log("All scraping methods failed. HTML length:", html.length);
      throw new Error("Could not find any slide images or CDN patterns on this page. The presentation might be private, requires login, or the structure is not supported.");
    }

    const candidates: PatternInfo[] = [];
    for (const rawUrl of foundUrls) {
      if (rawUrl.includes("icon") || rawUrl.includes("/thumbnail") || rawUrl.includes("80x60") || rawUrl.includes("120x90")) {
        continue;
      }
      const patternInfo = findSlideUrlPattern(rawUrl);
      if (patternInfo.pattern && patternInfo.pattern !== rawUrl) {
        candidates.push(patternInfo);
      }
    }

    // Sort candidates so the highest matched resolution is first (e.g. 2048, then 1024, etc.)
    candidates.sort((a, b) => {
      const resA = parseInt(a.matchedResolution || "0", 10);
      const resB = parseInt(b.matchedResolution || "0", 10);
      return resB - resA;
    });

    let bestPatternInfo: PatternInfo | null = null;
    if (candidates.length > 0) {
      bestPatternInfo = candidates[0];
    }

    if (!bestPatternInfo && foundUrls.length > 0) {
      const fallbackUrl = foundUrls.find(u => !u.includes("icon") && !u.includes("thumb")) || foundUrls[0];
      if (fallbackUrl) {
        bestPatternInfo = {
          pattern: fallbackUrl,
          isScribd: fallbackUrl.includes("scribd"),
          hasQuery: fallbackUrl.includes("?"),
        };
      }
    }

    if (!bestPatternInfo) {
      throw new Error("Could not find any presentation images. The document might be private or deleted.");
    }

    if (slideCount <= 0) {
      slideCount = $("section.slide, .slide, .slide-image, .slide_image").length;
    }
    if (slideCount <= 0) {
      const uniquePageNumbers = new Set<string>();
      const pageNumRegex = /-(\d+)-(1024|638|2048|320)/;
      for (const u of foundUrls) {
        const m = u.match(pageNumRegex);
        if (m) uniquePageNumbers.add(m[1]);
      }
      if (uniquePageNumbers.size > 0) {
        slideCount = uniquePageNumbers.size;
      } else {
        slideCount = 10;
      }
    }

    let resolvedSubfolder = "95";
    let resolvedResolution = "1024";
    let resolutionLabel = "HD (1024px)";
    const pattern = bestPatternInfo.pattern;
    const isScribd = bestPatternInfo.isScribd;

    if (!isScribd && pattern.includes("{subfolder}")) {
      const highestMatchedRes = parseInt(bestPatternInfo.matchedResolution || "0", 10);
      const highestMatchedSubfolder = bestPatternInfo.matchedSubfolder;
      
      let foundActive = false;
      
      const targetResolutions = [
        { subfolder: "75", resolution: "2048", label: "Ultra HD (2048px)" },
        { subfolder: "95", resolution: "1024", label: "HD (1024px)" },
        { subfolder: "85", resolution: "638", label: "Standard (638px)" }
      ];
      
      for (const target of targetResolutions) {
        const targetResNum = parseInt(target.resolution, 10);
        
        // If this exact resolution was found in the parsed HTML, it's 100% active and correct
        if (targetResNum === highestMatchedRes && highestMatchedSubfolder === target.subfolder) {
          resolvedSubfolder = target.subfolder;
          resolvedResolution = target.resolution;
          resolutionLabel = target.label;
          foundActive = true;
          break;
        }
        
        // Probe higher/different resolutions to see if they're available
        const probeUrl = pattern
          .replace("{subfolder}", target.subfolder)
          .replace("{page}", "1")
          .replace("{resolution}", target.resolution);
          
        const isAvailable = await probeSlideUrl(probeUrl, userAgent);
        if (isAvailable) {
          resolvedSubfolder = target.subfolder;
          resolvedResolution = target.resolution;
          resolutionLabel = target.label;
          foundActive = true;
          break;
        }
      }
      
      // Fallback directly to the parsed values if probing fails or didn't find standard resolutions
      if (!foundActive && bestPatternInfo.matchedResolution) {
        resolvedSubfolder = bestPatternInfo.matchedSubfolder || "85";
        resolvedResolution = bestPatternInfo.matchedResolution;
        resolutionLabel = `${bestPatternInfo.matchedResolution === "2048" ? "Ultra HD" : bestPatternInfo.matchedResolution === "1024" ? "HD" : "Standard"} (${bestPatternInfo.matchedResolution}px)`;
      }
    }

    let previewUrl = pattern.replace("{page}", "1");
    if (!isScribd && pattern.includes("{subfolder}")) {
      previewUrl = previewUrl
        .replace("{subfolder}", resolvedSubfolder)
        .replace("{resolution}", resolvedResolution);
    }

    res.json({
      title,
      slideCount,
      pattern,
      isScribd,
      resolvedSubfolder,
      resolvedResolution,
      resolutionLabel,
      previewUrl,
    });

  } catch (error: any) {
    console.error("Scrape Error:", error.message);
    res.status(500).json({ error: error.message || "Failed to parse SlideShare presentation details" });
  }
});

export default app;
