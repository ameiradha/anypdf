import { useState, useEffect } from "react";
import { Search, Download, FileText, Loader2, AlertCircle, CheckCircle2, Github, BookOpen } from "lucide-react";
import { PDFDocument } from "pdf-lib";
import { jsPDF } from "jspdf";
import pptxgen from "pptxgenjs";
import { motion, AnimatePresence } from "motion/react";

interface Metadata {
  title: string;
  pageCount: number;
  pageUrls: string[];
  isScribd?: boolean;
  scribdDownloadUrl?: string;
}

interface SlideShareMetadata {
  title: string;
  slideCount: number;
  pattern: string;
  isScribd: boolean;
  resolvedSubfolder: string;
  resolvedResolution: string;
  resolutionLabel: string;
  previewUrl: string;
}


async function fetchWithCorsFallback(targetUrl: string, timeoutMs = 6000): Promise<Response> {
  const proxies = [
    (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  ];

  for (let i = 0; i < proxies.length; i++) {
    const proxyUrl = proxies[i](targetUrl);
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);

    try {
      console.log(`Trying proxy ${i + 1}/${proxies.length}: ${proxyUrl}`);
      const res = await fetch(proxyUrl, { signal: controller.signal });
      clearTimeout(id);
      if (res.ok) {
        return res;
      }
      console.warn(`Proxy ${i + 1} returned status ${res.status}`);
    } catch (err: any) {
      clearTimeout(id);
      console.warn(`Proxy ${i + 1} failed or timed out:`, err.message || err);
    }
  }

  // Final direct attempt
  try {
    const res = await fetch(targetUrl);
    if (res.ok) return res;
  } catch (e) {}

  throw new Error("All public CORS proxies failed to load the resource. The server may be temporarily blocking requests, or the resource might be private/unavailable.");
}

export default function App() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [slideshareMetadata, setSlideshareMetadata] = useState<SlideShareMetadata | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<"idle" | "fetching" | "downloading" | "assembling" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"anyflip" | "scribd" | "slideshare" | "fliphtml5">("anyflip");

  const parseScribdUrl = (input: string) => {
    const urlClean = input.trim();
    if (/^\d{8,11}$/.test(urlClean)) {
      return { id: urlClean, title: "document" };
    }
    const match = urlClean.match(/scribd\.com\/(?:document|doc|presentation)\/(\d+)(?:\/([^\/\?#\s]+))?/i);
    if (match) {
      return {
        id: match[1],
        title: match[2] ? match[2].replace(/[-_]/g, " ") : "document"
      };
    }
    return null;
  };

  useEffect(() => {
    const trimmed = url.trim();
    if (trimmed.includes("slideshare.net") || trimmed.includes("slidesharecdn.com")) {
      setMode("slideshare");
    } else if (trimmed.includes("scribd.com") || /^\d{8,11}$/.test(trimmed)) {
      setMode("scribd");
    } else if (trimmed.includes("anyflip.com")) {
      setMode("anyflip");
    } else if (trimmed.includes("fliphtml5.com")) {
      setMode("fliphtml5");
    }
  }, [url]);

  const decryptFlipHtml5 = (encryptedString: string): Promise<any[]> => {
      return new Promise((resolve, reject) => {
          const scriptId = "fliphtml5-destring";
          if (!document.getElementById(scriptId)) {
              const script = document.createElement("script");
              script.id = scriptId;
              script.src = "https://static.fliphtml5.com/resourceFiles/html5_templates/js/deString.js";
              script.onload = () => processDecryption();
              script.onerror = () => reject(new Error("Failed to load decryptor"));
              document.head.appendChild(script);
          } else {
              processDecryption();
          }

          function processDecryption() {
              const checkModule = setInterval(() => {
                  const Module = (window as any).Module;
                  if (Module && Module._DeString) {
                      clearInterval(checkModule);
                      executeDecryption();
                  } else if (Module && !Module.onRuntimeInitialized) {
                      Module.onRuntimeInitialized = () => {
                          clearInterval(checkModule);
                          executeDecryption();
                      };
                  }
              }, 100);

              setTimeout(() => { clearInterval(checkModule); reject(new Error("Timeout loading decryptor module")); }, 10000);

              function executeDecryption() {
                  try {
                      const Module = (window as any).Module;
                      const q = Module.allocateUTF8(encryptedString);
                      const p = Module._DeString(q);
                      const resultRaw = Module.UTF8ToString(p);
                      
                      const startIdx = resultRaw.indexOf('[');
                      const endIdx = resultRaw.lastIndexOf(']');
                      if (startIdx !== -1 && endIdx !== -1) {
                          const jsonStr = resultRaw.substring(startIdx, endIdx + 1);
                          resolve(JSON.parse(jsonStr));
                      } else {
                          const objStartIdx = resultRaw.indexOf('{');
                          const objEndIdx = resultRaw.lastIndexOf('}');
                          if (objStartIdx !== -1 && objEndIdx !== -1) {
                              const jsonStr = resultRaw.substring(objStartIdx, objEndIdx + 1);
                              const obj = JSON.parse(jsonStr);
                              if (obj.page && Array.isArray(obj.page)) resolve(obj.page);
                              else resolve([]);
                          } else {
                              resolve([]);
                          }
                      }
                  } catch (e) {
                      reject(e);
                  }
              }
          }
      });
  };

  const constructFlipHtml5Urls = (pagesArray: any[], baseUrl: string, pageCount: number): string[] => {
      let pages = [...pagesArray];
      if (pageCount > pages.length) {
          for (let i = pages.length; i < pageCount; i++) {
              pages.push({});
          }
      }
      
      return pages.map((page, index) => {
          let url = page.pageUrl || page.largeUrl || page.n;
          if (!url) {
              url = `files/large/${index + 1}.webp`;
          }
          // Ensure we try webp
          if (typeof url === 'string') {
              url = url.replace('.jpg', '.webp');
          }
          if (url.startsWith('http')) return url;
          return `${baseUrl}${url.startsWith('/') ? url.substring(1) : url}`;
      });
  };

  const handleDownloadFlipHtml5 = async () => {
    if (!metadata || !metadata.pageUrls || metadata.pageUrls.length === 0) {
      setError("No document pages discovered.");
      return;
    }

    setLoading(true);
    setStatus("downloading");
    setProgress(0);
    setError("");

    try {
      let pdf: jsPDF | null = null;
      const total = metadata.pageUrls.length;

      for (let i = 0; i < total; i++) {
        const imageUrl = metadata.pageUrls[i];
        
        const variations = [
          imageUrl,
          imageUrl.replace('files/large/', 'files/mobile/'),
          imageUrl.replace('.jpg', '.webp'),
          imageUrl.replace('files/large/', 'files/mobile/').replace('.jpg', '.webp')
        ];

        let img = new Image();
        let success = false;
        let lastError = null;
        let objectUrl = "";

        for (const urlVariant of variations) {
          try {
            const response = await fetch(`/api/proxy-image?url=${encodeURIComponent(urlVariant)}`);
            if (!response.ok) {
              throw new Error(`Status ${response.status}`);
            }
            const contentType = response.headers.get("content-type") || "";
            if (contentType.includes("text/html")) {
              throw new Error("Received HTML instead of image");
            }

            const imageBlob = await response.blob();
            objectUrl = URL.createObjectURL(imageBlob);
            
            await new Promise((resolve, reject) => {
              img.onload = () => resolve(null);
              img.onerror = () => reject(new Error("Image decoding failed"));
              img.src = objectUrl;
            });
            
            success = true;
            break;
          } catch (e) {
            lastError = e;
            if (objectUrl) {
              
              objectUrl = "";
            }
          }
        }

        if (!success) {
          throw new Error(`Failed to fetch page ${i + 1} image data: ${lastError?.message || "Unknown error"}`);
        }

        const width = img.naturalWidth;
        const height = img.naturalHeight;

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error("Canvas context missing");
        ctx.drawImage(img, 0, 0);
          if (objectUrl) { URL.revokeObjectURL(objectUrl); }
        const imgData = canvas.toDataURL('image/jpeg', 0.9);

        if (i === 0) {
          pdf = new jsPDF({
            orientation: width > height ? 'landscape' : 'portrait',
            unit: 'px',
            format: [width, height]
          });
        } else if (pdf) {
          pdf.addPage([width, height], width > height ? 'landscape' : 'portrait');
        }

        if (pdf) {
          pdf.addImage(imgData, 'JPEG', 0, 0, width, height);
        }
        
        
        setProgress(((i + 1) / total) * 100);
      }

      setStatus("assembling");
      if (pdf) {
        pdf.save(`${metadata.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`);
      }
      setStatus("done");
    } catch (err: any) {
      setError(err.message || "Failed to assemble PDF");
      setStatus("error");
    }
    setLoading(false);
  };

  const handleFetchMetadata = async () => {
    if (!url) return;
    setLoading(true);
    setStatus("fetching");
    setError("");
    setMetadata(null);
    setSlideshareMetadata(null);
    setProgress(0);

    if (mode === "fliphtml5") {
      try {
        const response = await fetch(`/api/fetch-config?url=${encodeURIComponent(url.trim())}`);
        if (!response.ok) {
           const errData = await response.json().catch(() => ({}));
           throw new Error(errData.error || "Failed to fetch FlipHTML5 configuration");
        }
        const data = await response.json();
        
        let pageUrls: string[] = [];

        if (data.isEncrypted && data.encryptedString) {
            setStatus("fetching");
            try {
                const decryptedData = await decryptFlipHtml5(data.encryptedString);
                pageUrls = constructFlipHtml5Urls(decryptedData, data.baseUrl, data.pageCount);
            } catch (e) {
                console.error(e);
                throw new Error("Failed to decrypt FlipHTML5 configuration");
            }
        } else if (data.plainPages && data.plainPages.length > 0) {
            pageUrls = constructFlipHtml5Urls(data.plainPages, data.baseUrl, data.pageCount);
        } else {
            for (let i = 0; i < data.pageCount; i++) {
                pageUrls.push(`${data.baseUrl}files/large/${i + 1}.webp`);
            }
        }
        
        if (pageUrls.length === 0) throw new Error("No pages found in FlipHTML5 document");

        setMetadata({
            title: data.title || "document",
            pageCount: pageUrls.length,
            pageUrls: pageUrls
        });
        setStatus("idle");
      } catch (err: any) {
        setError(err.message);
        setStatus("error");
      }
      setLoading(false);
      return;
    }

    if (mode === "slideshare") {
      try {
        const response = await fetch(`/api/scrape?url=${encodeURIComponent(url.trim())}`);
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Server returned HTTP ${response.status}`);
        }
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        setSlideshareMetadata(data);
        setStatus("idle");
        setLoading(false);
      } catch (err: any) {
        console.error("SlideShare fetch error:", err);
        setError(err.message || "Failed to fetch SlideShare presentation details.");
        setStatus("error");
        setLoading(false);
      }
      return;
    }

    if (mode === "scribd") {
      try {
        const scribd = parseScribdUrl(url);
        if (!scribd) {
          throw new Error("Invalid Scribd URL format. Please provide a URL like: https://www.scribd.com/document/285079868/");
        }
        const downloadUrl = `https://compress-pdf.vietdreamhouse.com/?fileurl=https://scribd.downloader.tips/pdownload/${scribd.id}/document&title=${encodeURIComponent(scribd.title)}`;
        
        setMetadata({
          title: scribd.title === "document" ? "Scribd Document" : scribd.title,
          pageCount: 0,
          pageUrls: [],
          isScribd: true,
          scribdDownloadUrl: downloadUrl,
        });
        setStatus("idle");
      } catch (err: any) {
        setError(err.message);
        setStatus("error");
      } finally {
        setLoading(false);
      }
      return;
    }

    try {
      const endpoint = "/api/metadata";
      let data;
      try {
        const resp = await fetch(`${endpoint}?url=${encodeURIComponent(url)}`);
        
        // Check content type before parsing as JSON
        const contentType = resp.headers.get("content-type");
        if (resp.ok && contentType && contentType.includes("application/json")) {
          data = await resp.json();
        } else {
          throw new Error(`Server returned error status ${resp.status}`);
        }
      } catch (serverErr) {
        console.warn("Server metadata fetch failed, attempting client-side fallback parsing...", serverErr);
        
        // Parse user/book from URL
        const match = url.match(/anyflip\.com\/([\w.-]+)\/([\w.-]+)/i);
        if (!match) {
          throw new Error("Invalid AnyFlip URL format. Please provide a URL like: https://anyflip.com/user/book/");
        }
        
        const userPath = `/${match[1]}/${match[2]}/`;
        const configJsUrl = `https://online.anyflip.com${userPath}mobile/javascript/config.js`;
        
        // Try to fetch configJs via public CORS proxies
        let jsText = "";
        try {
          const fallbackResp = await fetchWithCorsFallback(configJsUrl);
          jsText = await fallbackResp.text();
        } catch (proxyErr: any) {
          throw new Error(`Failed to fetch book configuration. AnyFlip might be down or blocking the request.`);
        }
        
        jsText = jsText.trim();
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
          config = (new Function(`return ${objStr}`))();
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
            downloadPath = `files/large/${i + 1}.jpg`;
          } else {
            if (!downloadPath.startsWith("files/large/") && !downloadPath.startsWith("files/mobile/")) {
              if (downloadPath.startsWith("large/")) {
                downloadPath = `files/${downloadPath}`;
              } else {
                downloadPath = `files/large/${downloadPath}`;
              }
            }
          }
          
          pageUrls.push(`https://online.anyflip.com/${userPathClean}${downloadPath}`);
        }
        
        data = {
          title: safeTitle,
          pageCount: count,
          pageUrls,
        };
      }
      
      setMetadata(data);
      setStatus("idle");
    } catch (err: any) {
      console.error("Fetch Error:", err);
      setError(err.message);
      setStatus("error");
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadSlideShare = async (format: "pdf" | "pptx") => {
    if (!slideshareMetadata) return;
    setLoading(true);
    setStatus("downloading");
    setProgress(0);
    setError("");

    try {
      const { pattern, isScribd, resolvedSubfolder, resolvedResolution, slideCount, title } = slideshareMetadata;
      const count = parseInt(String(slideCount), 10);
      
      let activeResolution = resolvedResolution || "1024";
      let activeSubfolder = resolvedSubfolder || "95";

      if (!isScribd) {
        if (count > 64) {
          activeResolution = "638";
          activeSubfolder = "85";
        }
      }

      const imageUrls: string[] = [];
      for (let i = 1; i <= count; i++) {
        let imgUrl = pattern.replace("{page}", String(i));
        if (!isScribd && pattern.includes("{subfolder}")) {
          imgUrl = imgUrl
            .replace("{subfolder}", activeSubfolder)
            .replace("{resolution}", activeResolution);
        }
        imageUrls.push(imgUrl);
      }

      const total = imageUrls.length;
      const imageElements: { img: HTMLImageElement, width: number, height: number, dataUrl: string }[] = [];
      
      for (let i = 0; i < total; i++) {
        const imageUrl = imageUrls[i];
        
        let response;
        try {
          response = await fetch(`/api/proxy-image?url=${encodeURIComponent(imageUrl)}`);
          if (!response.ok) {
            throw new Error(`Status ${response.status}`);
          }
        } catch (proxyErr) {
          throw new Error(`Failed to fetch slide ${i + 1} image data. Please try again.`);
        }
        
        const imageBytes = await response.arrayBuffer();
        
        try {
          const blob = new Blob([imageBytes]);
          const url = URL.createObjectURL(blob);
          
          const img = new Image();
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Image decoding timed out.")), 20000);
            img.onload = () => {
              clearTimeout(timeout);
              resolve(null);
            };
            img.onerror = () => {
              clearTimeout(timeout);
              reject(new Error(`Browser failed to decode image data for slide ${i + 1}`));
            };
            img.src = url;
          });
          
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Canvas rendering context unavailable");
          ctx.drawImage(img, 0, 0);
          if (url) { URL.revokeObjectURL(url); }
          
          const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
          
          imageElements.push({
            img,
            width: img.width,
            height: img.height,
            dataUrl
          });
          
          
        } catch (imgErr: any) {
          console.error(`Error on slide ${i + 1}:`, imgErr);
          throw new Error(`Slide ${i + 1} processing failed: ${imgErr.message}`);
        }

        setProgress(Math.round(((i + 1) / total) * 90));
      }

      setStatus("assembling");
      
      const safeTitle = String(title || "presentation").replace(/[<>:"/\\|?*]/g, "").trim();
      let blobUrl = "";
      
      if (format === "pdf") {
        const pdfDoc = await PDFDocument.create();
        for (let i = 0; i < imageElements.length; i++) {
          const { dataUrl, width, height } = imageElements[i];
          const base64Data = dataUrl.split(",")[1];
          const jpegImage = await pdfDoc.embedJpg(base64Data);
          
          const page = pdfDoc.addPage([jpegImage.width, jpegImage.height]);
          page.drawImage(jpegImage, {
            x: 0,
            y: 0,
            width: jpegImage.width,
            height: jpegImage.height,
          });
        }
        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: "application/pdf" });
        blobUrl = URL.createObjectURL(blob);
        
      } else if (format === "pptx") {
        const pptx = new pptxgen();
        const firstImg = imageElements[0];
        const aspect = firstImg.width / firstImg.height;
        const layoutWidth = 10;
        const layoutHeight = 10 / aspect;

        pptx.defineLayout({
          name: "SLIDESHARE_LAYOUT",
          width: layoutWidth,
          height: layoutHeight
        });
        pptx.layout = "SLIDESHARE_LAYOUT";

        for (let i = 0; i < imageElements.length; i++) {
          const { dataUrl } = imageElements[i];
          const newSlide = pptx.addSlide();
          newSlide.addImage({
            data: dataUrl,
            x: 0,
            y: 0,
            w: layoutWidth,
            h: layoutHeight,
            sizing: { type: "contain", w: layoutWidth, h: layoutHeight, x: 0, y: 0 }
          });
        }
        
        const pptxBlob = await pptx.write({ outputType: "blob" }) as Blob;
        blobUrl = URL.createObjectURL(pptxBlob);
      }
      
      setProgress(100);

      const link = document.createElement("a");
      link.href = blobUrl;
      const extension = format === "pptx" ? "pptx" : "pdf";
      link.download = `${safeTitle}.${extension}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      
      setStatus("done");
    } catch (err: any) {
      console.error("SlideShare compilation error:", err);
      setError(err.message || "Failed to download and compile presentation.");
      setStatus("error");
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    console.log("handleDownload called");
    if (!metadata || !metadata.pageUrls || metadata.pageUrls.length === 0) {
      console.warn("No metadata or page URLs found", metadata);
      setError("No document pages discovered. Please try a different book URL.");
      return;
    }

    setLoading(true);
    setStatus("downloading");
    setProgress(0);
    setError("");

    try {
      console.log("Creating PDF document...");
      const pdfDoc = await PDFDocument.create();
      const total = metadata.pageUrls.length;

      for (let i = 0; i < total; i++) {
        const imageUrl = metadata.pageUrls[i];
        console.log(`Processing page ${i + 1}/${total}: ${imageUrl}`);
        
        // Use proxy to avoid CORS with public fallbacks
        const variations = [
          imageUrl,
          imageUrl.replace('files/large/', 'files/mobile/'),
          imageUrl.replace('.jpg', '.webp'),
          imageUrl.replace('files/large/', 'files/mobile/').replace('.jpg', '.webp')
        ];

        let img = new Image();
        let success = false;
        let lastError = null;
        let objectUrl = "";
        let imageBytes: ArrayBuffer | null = null;

        for (const urlVariant of variations) {
          try {
            const response = await fetch(`/api/proxy-image?url=${encodeURIComponent(urlVariant)}`);
            if (!response.ok) {
              throw new Error(`Status ${response.status}`);
            }
            
            const contentType = response.headers.get("content-type") || "";
            if (contentType.includes("text/html")) {
              throw new Error("Received HTML instead of image");
            }
            
            imageBytes = await response.arrayBuffer();
            const blob = new Blob([imageBytes]);
            objectUrl = URL.createObjectURL(blob);
            
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => reject(new Error("Image decoding timed out. The server might be slow.")), 20000);
              img.onload = () => {
                clearTimeout(timeout);
                resolve(null);
              };
              img.onerror = () => {
                clearTimeout(timeout);
                reject(new Error(`Browser failed to decode image data for page ${i + 1}`));
              };
              img.src = objectUrl;
            });

            success = true;
            break;
          } catch (e) {
            lastError = e;
            if (objectUrl) {
              
              objectUrl = "";
            }
          }
        }

        if (!success || !imageBytes) {
          throw new Error(`Failed to fetch page ${i + 1} image data: ${lastError?.message || "AnyFlip's servers might be blocking requests."}`);
        }
        
        try {
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Canvas rendering context unavailable");
          ctx.drawImage(img, 0, 0);
          if (objectUrl) { URL.revokeObjectURL(objectUrl); }
          
          const pngDataUrl = canvas.toDataURL("image/png");
          const base64Data = pngDataUrl.split(",")[1];
          const pngImage = await pdfDoc.embedPng(base64Data);
          
          const page = pdfDoc.addPage([pngImage.width, pngImage.height]);
          page.drawImage(pngImage, {
            x: 0,
            y: 0,
            width: pngImage.width,
            height: pngImage.height,
          });
          
          
        } catch (imgErr: any) {
          console.error(`Error on page ${i + 1}:`, imgErr);
          throw new Error(`Page ${i + 1} processing failed: ${imgErr.message}`);
        }

        setProgress(Math.round(((i + 1) / total) * 100));
      }

      console.log("Generating final PDF bytes...");
      setStatus("assembling");
      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const dlUrl = URL.createObjectURL(blob);
      
      const link = document.createElement("a");
      link.href = dlUrl;
      link.download = `${metadata.title || "AnyFlip_Book"}.pdf`;
      document.body.appendChild(link); // Append to body to ensure it works in all browsers
      link.click();
      document.body.removeChild(link);
      
      console.log("Download triggered!");
      setStatus("done");
    } catch (err: any) {
      console.error("Critical extraction error:", err);
      setError(err.message || "An unexpected error occurred during extraction.");
      setStatus("error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FBFBFA] text-stone-800 font-sans selection:bg-blue-100 selection:text-blue-900 overflow-x-hidden flex flex-col">
      {/* Navbar */}
      <nav className="h-16 border-b border-stone-200/80 bg-white/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-5xl mx-auto h-full flex items-center justify-between px-8">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shadow-md transition-all duration-300 ${
              mode === "scribd" 
                ? "bg-emerald-600 shadow-emerald-600/10" 
                : mode === "slideshare"
                ? "bg-indigo-600 shadow-indigo-600/10"
                : mode === "fliphtml5"
                ? "bg-orange-600 shadow-orange-600/10"
                : "bg-blue-600 shadow-blue-600/10"
            }`}>
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-lg font-display font-bold tracking-tight text-stone-900">
              AnyPDF <span className="text-stone-400 font-medium whitespace-nowrap">Converter</span>
            </h1>
          </div>
          <div className="flex items-center gap-6">
          </div>
        </div>
      </nav>

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-12 md:py-20 flex flex-col items-center">
        {/* Hero Section */}
        <div className="text-center mb-8">
          <motion.h2 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-4xl md:text-5xl font-display font-bold text-stone-900 mb-4 tracking-tight"
          >
            {mode === "anyflip" ? (
              <>AnyFlip to <span className="text-blue-600">PDF</span></>
            ) : mode === "slideshare" ? (
              <>SlideShare to <span className="text-indigo-600">PDF/PPTX</span></>
            ) : mode === "fliphtml5" ? (
              <>FlipHTML5 to <span className="text-orange-600">PDF</span></>
            ) : (
              <>Scribd to <span className="text-emerald-600">PDF</span></>
            )}
          </motion.h2>
          <p className="text-stone-500 max-w-lg mx-auto font-medium text-sm leading-relaxed">
            {mode === "anyflip" ? (
              "Paste an AnyFlip URL below to begin the high-resolution extraction and PDF assembly process."
            ) : mode === "slideshare" ? (
              "Paste a SlideShare presentation URL to extract high-resolution slides and export as PDF or native PowerPoint."
            ) : mode === "fliphtml5" ? (
              "Paste a FlipHTML5 document URL below to generate a high-resolution PDF."
            ) : (
              "Paste a Scribd document URL below to generate a high-speed direct download link."
            )}
          </p>
        </div>

        {/* Mode Selector Tabs */}
        <div className="flex bg-stone-100 p-1 rounded-2xl border border-stone-200/60 mb-10 gap-1 w-full max-w-md justify-center shadow-sm">
          <button
            onClick={() => { setMode("anyflip"); setUrl(""); setMetadata(null); setSlideshareMetadata(null); setError(""); }}
            className={`flex-1 py-2 px-3 text-xs font-bold rounded-xl transition-all ${
              mode === "anyflip" 
                ? "bg-white text-blue-600 shadow-sm border border-stone-200/50 font-display" 
                : "text-stone-500 hover:text-stone-800 font-sans"
            }`}
          >
            AnyFlip
          </button>
          <button
            onClick={() => { setMode("scribd"); setUrl(""); setMetadata(null); setSlideshareMetadata(null); setError(""); }}
            className={`flex-1 py-2 px-3 text-xs font-bold rounded-xl transition-all ${
              mode === "scribd" 
                ? "bg-white text-emerald-600 shadow-sm border border-stone-200/50 font-display" 
                : "text-stone-500 hover:text-stone-800 font-sans"
            }`}
          >
            Scribd
          </button>
          <button
            onClick={() => { setMode("slideshare"); setUrl(""); setMetadata(null); setSlideshareMetadata(null); setError(""); }}
            className={`flex-1 py-2 px-3 text-xs font-bold rounded-xl transition-all ${
              mode === "slideshare" 
                ? "bg-white text-indigo-600 shadow-sm border border-stone-200/50 font-display" 
                : "text-stone-500 hover:text-stone-800 font-sans"
            }`}
          >
            SlideShare
          </button>
          <button
            onClick={() => { setMode("fliphtml5"); setUrl(""); setMetadata(null); setSlideshareMetadata(null); setError(""); }}
            className={`flex-1 py-2 px-3 text-xs font-bold rounded-xl transition-all ${
              mode === "fliphtml5" 
                ? "bg-white text-orange-600 shadow-sm border border-stone-200/50 font-display" 
                : "text-stone-500 hover:text-stone-800 font-sans"
            }`}
          >
            FlipHTML5
          </button>
        </div>

        {/* Search Bar / Input Area */}
        <div className="w-full max-w-2xl bg-white border border-stone-200 rounded-3xl p-2.5 shadow-md hover:shadow-lg transition-all duration-300 relative overflow-hidden mb-12">
          <div className="flex flex-col md:flex-row gap-2">
            <div className="relative flex-1 group">
              <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                <Search className={`w-5 h-5 text-stone-400 transition-colors ${
                  mode === "scribd" 
                    ? "group-focus-within:text-emerald-600" 
                    : mode === "slideshare"
                    ? "group-focus-within:text-indigo-600"
                    : mode === "fliphtml5"
                    ? "group-focus-within:text-orange-600"
                    : "group-focus-within:text-blue-600"
                }`} />
              </div>
              <input
                type="text"
                placeholder={
                  mode === "anyflip" 
                    ? "https://anyflip.com/user/book/" 
                    : mode === "slideshare"
                    ? "https://www.slideshare.net/user/presentation"
                    : mode === "fliphtml5"
                    ? "https://online.fliphtml5.com/xxxx/yyyy/"
                    : "https://www.scribd.com/document/285079868/document"
                }
                className={`w-full pl-12 pr-4 py-3.5 bg-stone-50 border border-stone-200/80 rounded-2xl text-stone-900 focus:ring-4 placeholder:text-stone-400 font-sans transition-all focus:outline-none ${
                  mode === "scribd" 
                    ? "focus:ring-emerald-500/10 focus:border-emerald-500" 
                    : mode === "slideshare"
                    ? "focus:ring-indigo-500/10 focus:border-indigo-500"
                    : mode === "fliphtml5"
                    ? "focus:ring-orange-500/10 focus:border-orange-500"
                    : "focus:ring-blue-500/10 focus:border-blue-500"
                }`}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleFetchMetadata()}
              />
            </div>
            <button
              onClick={handleFetchMetadata}
              disabled={loading || !url}
              className={`text-white px-8 py-3.5 rounded-2xl font-bold transition-all flex items-center justify-center gap-2 shrink-0 shadow-sm active:scale-95 font-display ${
                mode === "scribd" 
                  ? "bg-emerald-600 hover:bg-emerald-500 disabled:bg-stone-100 disabled:text-stone-400 shadow-emerald-600/5" 
                  : mode === "slideshare"
                  ? "bg-indigo-600 hover:bg-indigo-500 disabled:bg-stone-100 disabled:text-stone-400 shadow-indigo-600/5"
                  : mode === "fliphtml5"
                  ? "bg-orange-600 hover:bg-orange-500 disabled:bg-stone-100 disabled:text-stone-400 shadow-orange-600/5"
                  : "bg-blue-600 hover:bg-blue-500 disabled:bg-stone-100 disabled:text-stone-400 shadow-blue-600/5"
              }`}
            >
              {loading && status === "fetching" ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  Process
                  <Download className="w-4 h-4 ml-1" />
                </>
              )}
            </button>
          </div>
        </div>

        {/* Content Section */}
        <div className="w-full max-w-2xl">
          <AnimatePresence mode="wait">
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="bg-rose-50 border border-rose-200/80 text-rose-700 p-4 rounded-2xl flex items-center gap-3"
              >
                <AlertCircle className="w-5 h-5 shrink-0 text-rose-600" />
                <div className="text-sm font-semibold">{error}</div>
              </motion.div>
            )}

            {metadata && status === "idle" && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white border border-stone-200 p-6 rounded-3xl shadow-md hover:shadow-lg transition-all duration-300 relative group overflow-hidden"
              >
                <div className="flex flex-col md:flex-row items-center gap-6 relative z-10">
                  <div className={`w-24 h-32 bg-stone-50 rounded-xl flex items-center justify-center border shrink-0 relative overflow-hidden shadow-sm ${mode === "scribd" ? "border-emerald-200" : mode === "fliphtml5" ? "border-orange-200" : "border-stone-200"}`}>
                    <FileText className={`w-8 h-8 ${mode === "scribd" ? "text-emerald-600" : mode === "fliphtml5" ? "text-orange-600" : "text-stone-400"}`} />
                    <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-stone-100 to-transparent"></div>
                    <div className="absolute inset-0 flex items-center justify-center text-[8px] font-mono font-bold text-stone-400 tracking-wider">
                      {metadata.isScribd ? "SCRIBD" : "AUTO-COVER"}
                    </div>
                  </div>
                  <div className="flex-1 text-center md:text-left overflow-hidden">
                    <h3 className="text-xl font-display font-bold text-stone-900 mb-1 truncate leading-tight">{metadata.title}</h3>
                    <p className={`text-xs font-mono mb-6 flex items-center justify-center md:justify-start gap-2 uppercase tracking-wide ${metadata.isScribd ? "text-emerald-600" : mode === "fliphtml5" ? "text-orange-600" : "text-blue-600"}`}>
                      {metadata.isScribd ? "Scribd Direct Downloader • Secure Tunnel" : `${metadata.pageCount} Pages • High DPI • WebP SOURCE`}
                    </p>
                    {metadata.isScribd ? (
                      <a
                        href={metadata.scribdDownloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full md:w-auto inline-flex bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-8 py-3.5 rounded-xl font-bold transition-all items-center justify-center gap-2 shadow-sm shadow-emerald-600/10 active:scale-95 cursor-pointer no-underline font-display"
                      >
                        <Download className="w-5 h-5" />
                        Download PDF
                      </a>
                    ) : (
                      <button
                        onClick={mode === "fliphtml5" ? handleDownloadFlipHtml5 : handleDownload}
                        disabled={loading}
                        className="w-full md:w-auto bg-stone-950 text-white hover:bg-stone-850 disabled:bg-stone-200 disabled:text-stone-400 px-8 py-3.5 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-sm active:scale-95 cursor-pointer disabled:cursor-not-allowed font-display"
                      >
                        <Download className="w-5 h-5" />
                        Begin Extraction
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {slideshareMetadata && status === "idle" && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white border border-stone-200 p-6 rounded-3xl shadow-md hover:shadow-lg transition-all duration-300 relative group overflow-hidden"
              >
                <div className="flex flex-col md:flex-row items-center gap-6 relative z-10">
                  <div className="w-24 h-32 bg-stone-50 rounded-xl flex items-center justify-center border shrink-0 relative overflow-hidden shadow-sm border-indigo-200">
                    {slideshareMetadata.previewUrl ? (
                      <img 
                        src={slideshareMetadata.previewUrl} 
                        alt="Slide preview" 
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <FileText className="w-8 h-8 text-indigo-600" />
                    )}
                    <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-stone-100 to-transparent"></div>
                    <div className="absolute inset-0 flex items-center justify-center text-[8px] font-mono font-bold text-stone-400 tracking-wider">
                      SLIDESHARE
                    </div>
                  </div>
                  <div className="flex-1 text-center md:text-left overflow-hidden">
                    <h3 className="text-xl font-display font-bold text-stone-900 mb-1 truncate leading-tight">
                      {slideshareMetadata.title}
                    </h3>
                    <p className="text-xs font-mono mb-6 flex items-center justify-center md:justify-start gap-2 uppercase tracking-wide text-indigo-600">
                      SlideShare • {slideshareMetadata.slideCount} Slides • {slideshareMetadata.resolutionLabel}
                    </p>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <button
                        onClick={() => handleDownloadSlideShare("pdf")}
                        disabled={loading}
                        className="flex-1 bg-stone-950 text-white hover:bg-stone-850 disabled:bg-stone-200 disabled:text-stone-400 px-6 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-sm active:scale-95 cursor-pointer font-display text-sm"
                      >
                        <Download className="w-4 h-4" />
                        Download PDF
                      </button>
                      <button
                        onClick={() => handleDownloadSlideShare("pptx")}
                        disabled={loading}
                        className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white disabled:bg-stone-200 disabled:text-stone-400 px-6 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-sm active:scale-95 cursor-pointer font-display text-sm"
                      >
                        <Download className="w-4 h-4" />
                        Download PPTX (PowerPoint)
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {loading && (status === "downloading" || status === "assembling") && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white border border-stone-200 p-8 rounded-3xl shadow-md text-center"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-mono font-bold text-stone-400 uppercase tracking-wider">Engine Status</span>
                  <span className="text-xs font-mono text-stone-800">{status === "downloading" ? "Downloading Assets" : "Assembling PDF"} • {progress}%</span>
                </div>
                <div className="h-2 w-full bg-stone-100 rounded-full overflow-hidden mb-6 border border-stone-200/60 shadow-inner">
                  <motion.div
                    className={`h-full transition-all duration-300 ${
                      mode === "scribd" 
                        ? "bg-emerald-600 shadow-[0_0_12px_rgba(5,150,105,0.2)]" 
                        : mode === "slideshare"
                        ? "bg-indigo-600 shadow-[0_0_12px_rgba(79,70,229,0.2)]"
                        : mode === "fliphtml5"
                        ? "bg-orange-600 shadow-[0_0_12px_rgba(234,88,12,0.2)]"
                        : "bg-blue-600 shadow-[0_0_12px_rgba(37,99,235,0.2)]"
                    }`}
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ type: "spring", bounce: 0, duration: 0.5 }}
                  />
                </div>
                <div className="flex justify-center gap-1.5">
                  {[...Array(5)].map((_, i) => (
                    <div 
                      key={i} 
                      className={`h-1 w-8 rounded-full transition-colors duration-500 ${
                        progress > (i * 20) 
                          ? mode === "scribd"
                            ? "bg-emerald-600"
                            : mode === "slideshare"
                            ? "bg-indigo-600"
                            : mode === "fliphtml5"
                            ? "bg-orange-600"
                            : "bg-blue-600"
                          : "bg-stone-200"
                      }`} 
                    />
                  ))}
                </div>
              </motion.div>
            )}

            {status === "done" && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className={`${
                  mode === "scribd" 
                    ? "bg-emerald-50 border-emerald-200/60" 
                    : mode === "slideshare"
                    ? "bg-indigo-50 border-indigo-200/60"
                    : mode === "fliphtml5"
                    ? "bg-orange-50 border-orange-200/60"
                    : "bg-blue-50 border-blue-200/60"
                } border p-8 rounded-3xl text-center`}
              >
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-md ${
                  mode === "scribd" 
                    ? "bg-emerald-600 shadow-emerald-600/10" 
                    : mode === "slideshare"
                    ? "bg-indigo-600 shadow-indigo-600/10"
                    : mode === "fliphtml5"
                    ? "bg-orange-600 shadow-orange-600/10"
                    : "bg-blue-600 shadow-blue-600/10"
                }`}>
                  <CheckCircle2 className="w-8 h-8 text-white" />
                </div>
                <h3 className="text-2xl font-display font-bold text-stone-900 mb-2 italic">Extraction Complete</h3>
                <p className="text-stone-600 mb-8 text-sm font-medium">Your presentation/document is ready and has been saved to your downloads.</p>
                <button
                  onClick={() => { setStatus("idle"); setMetadata(null); setSlideshareMetadata(null); setUrl(""); }}
                  className="bg-stone-900 hover:bg-stone-800 text-white px-8 py-3 rounded-xl font-bold transition-all border border-stone-800 shadow-sm active:scale-95 font-display"
                >
                  Convert Another Document
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>


      </main>

      <footer className="h-12 border-t border-stone-200 bg-white/60 flex items-center justify-center px-8 text-[9px] font-mono uppercase tracking-wider text-stone-400 font-bold">
        <div>All rights reserved</div>
      </footer>
    </div>
  );
}
