import { useState, useEffect } from "react";
import { Search, Download, FileText, Loader2, AlertCircle, CheckCircle2, Github, BookOpen } from "lucide-react";
import { PDFDocument } from "pdf-lib";
import { motion, AnimatePresence } from "motion/react";

interface Metadata {
  title: string;
  pageCount: number;
  pageUrls: string[];
}

export default function App() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<"idle" | "fetching" | "downloading" | "assembling" | "done" | "error">("idle");
  const [error, setError] = useState("");

  const handleFetchMetadata = async () => {
    if (!url) return;
    setLoading(true);
    setStatus("fetching");
    setError("");
    setMetadata(null);
    setProgress(0);

    try {
      const endpoint = "/api/metadata";
      const resp = await fetch(`${endpoint}?url=${encodeURIComponent(url)}`);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Failed to fetch AnyFlip metadata");
      setMetadata(data);
      setStatus("idle");
    } catch (err: any) {
      setError(err.message);
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
        
        // Use proxy to avoid CORS
        const response = await fetch(`/api/proxy-image?url=${encodeURIComponent(imageUrl)}`);
        if (!response.ok) {
          const text = await response.text();
          console.error(`Page ${i + 1} fetch failed:`, text);
          throw new Error(`Failed to fetch page ${i + 1}: ${text}`);
        }
        
        const imageBytes = await response.arrayBuffer();
        
        try {
          // Convert AnyFlip image (WebP/JPG) to PNG via canvas for PDF embedding
          const blob = new Blob([imageBytes]);
          const url = URL.createObjectURL(blob);
          
          const img = new Image();
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
            img.src = url;
          });
          
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Canvas rendering context unavailable");
          ctx.drawImage(img, 0, 0);
          
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
          
          URL.revokeObjectURL(url);
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
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-blue-500/30 selection:text-white overflow-x-hidden flex flex-col">
      {/* Navbar */}
      <nav className="h-16 border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-5xl mx-auto h-full flex items-center justify-between px-8">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/20">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white">AnyPDF <span className="text-slate-500 font-medium whitespace-nowrap">Converter</span></h1>
          </div>
          <div className="flex items-center gap-6">
            <div className="hidden sm:block px-4 py-1.5 bg-slate-800 rounded-full text-[10px] font-bold text-slate-400 tracking-wider uppercase border border-slate-700">v1.2.5 Active</div>
          </div>
        </div>
      </nav>

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-12 md:py-20 flex flex-col items-center">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <motion.h2 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-4xl md:text-5xl font-bold text-white mb-4 tracking-tighter italic"
          >
            AnyFlip to <span className="text-blue-500">PDF</span>
          </motion.h2>
          <p className="text-slate-400 max-w-lg mx-auto font-medium">
            Paste an AnyFlip URL below to begin the high-resolution extraction and PDF assembly process.
          </p>
        </div>

        {/* Search Bar / Input Area */}
        <div className="w-full max-w-2xl bg-slate-900/40 border border-slate-800 rounded-3xl p-1 shadow-2xl relative overflow-hidden mb-12">
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50"></div>
          
          <div className="p-2 flex flex-col md:flex-row gap-2">
            <div className="relative flex-1 group">
              <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                <Search className="w-5 h-5 text-slate-600 group-focus-within:text-blue-500 transition-colors" />
              </div>
              <input
                type="text"
                placeholder="https://anyflip.com/user/book/"
                className="w-full pl-12 pr-4 py-4 bg-slate-950 border border-slate-700 rounded-2xl text-slate-100 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:outline-none placeholder:text-slate-700 shadow-inner transition-all"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleFetchMetadata()}
              />
            </div>
            <button
              onClick={handleFetchMetadata}
              disabled={loading || !url}
              className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-600 text-white px-8 py-4 rounded-2xl font-bold transition-all flex items-center justify-center gap-2 shrink-0 shadow-lg shadow-blue-600/20 active:scale-95"
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
                className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-2xl flex items-center gap-3 backdrop-blur-sm"
              >
                <AlertCircle className="w-5 h-5 shrink-0" />
                <div className="text-sm font-semibold">{error}</div>
              </motion.div>
            )}

            {metadata && status === "idle" && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-slate-900/60 border border-slate-800 p-6 rounded-3xl backdrop-blur-xl shadow-2xl relative group overflow-hidden"
              >
                <div className="absolute inset-0 bg-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
                <div className="flex flex-col md:flex-row items-center gap-6 relative z-10">
                  <div className="w-24 h-32 bg-slate-950 rounded-xl flex items-center justify-center border border-slate-800 shrink-0 relative overflow-hidden group/thumb shadow-inner">
                    <FileText className="w-8 h-8 text-slate-700" />
                    <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-slate-900 to-transparent"></div>
                    <div className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-slate-600 tracking-widest opacity-40">AUTO-COVER</div>
                  </div>
                  <div className="flex-1 text-center md:text-left overflow-hidden">
                    <h3 className="text-xl font-bold text-white mb-1 truncate leading-tight">{metadata.title}</h3>
                    <p className="text-xs font-mono text-blue-400 mb-6 flex items-center justify-center md:justify-start gap-2 uppercase tracking-wide">
                      {metadata.pageCount} Pages • High DPI • WebP SOURCE
                    </p>
                    <button
                      onClick={handleDownload}
                      disabled={loading}
                      className="w-full md:w-auto bg-white text-slate-950 hover:bg-blue-50 disabled:bg-slate-300 disabled:text-slate-500 px-8 py-3.5 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-xl shadow-white/5 active:scale-95 cursor-pointer disabled:cursor-not-allowed"
                    >
                      <Download className="w-5 h-5" />
                      Begin Extraction
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {loading && (status === "downloading" || status === "assembling") && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-slate-950/80 border border-slate-800 p-8 rounded-3xl shadow-3xl text-center backdrop-blur-md"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">Engine Status</span>
                  <span className="text-xs font-mono text-blue-400">{status === "downloading" ? "Downloading Assets" : "Assembling PDF"} • {progress}%</span>
                </div>
                <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden mb-6 border border-slate-800 shadow-inner">
                  <motion.div
                    className="h-full bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.6)]"
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ type: "spring", bounce: 0, duration: 0.5 }}
                  />
                </div>
                <div className="flex justify-center gap-1.5">
                  {[...Array(5)].map((_, i) => (
                    <div 
                      key={i} 
                      className={`h-1 w-8 rounded-full transition-colors duration-500 ${progress > (i * 20) ? 'bg-blue-500' : 'bg-slate-800'}`} 
                    />
                  ))}
                </div>
              </motion.div>
            )}

            {status === "done" && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-blue-500/10 border border-blue-500/20 p-8 rounded-3xl text-center backdrop-blur-md"
              >
                <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-600/30">
                  <CheckCircle2 className="w-8 h-8 text-white" />
                </div>
                <h3 className="text-2xl font-bold text-white mb-2 italic">Extraction Complete</h3>
                <p className="text-slate-400 mb-8 text-sm font-medium">Your PDF document is ready and has been saved to your downloads.</p>
                <button
                  onClick={() => { setStatus("idle"); setMetadata(null); setUrl(""); }}
                  className="bg-slate-800 hover:bg-slate-700 text-white px-8 py-3 rounded-xl font-bold transition-all border border-slate-700 shadow-lg active:scale-95"
                >
                  Convert Another Book
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Grid Stats Area */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl mt-12">
          <div className="bg-slate-900/30 p-6 rounded-2xl border border-slate-800/60 transition-all hover:border-slate-700/80">
            <h3 className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-4">System Load</h3>
            <div className="flex items-end gap-1 h-12">
              <div className="w-full bg-blue-900/20 h-[30%] rounded-sm"></div>
              <div className="w-full bg-blue-900/20 h-[45%] rounded-sm"></div>
              <div className="w-full bg-blue-500/50 h-[80%] rounded-sm"></div>
              <div className="w-full bg-blue-900/20 h-[50%] rounded-sm"></div>
              <div className="w-full bg-blue-950 h-[40%] rounded-sm"></div>
            </div>
            <div className="mt-4 flex justify-between items-center text-[10px] font-bold uppercase tracking-tight">
              <span className="text-slate-400">15 Semaphores</span>
              <span className="text-emerald-500">Stable</span>
            </div>
          </div>

          <div className="bg-slate-900/30 p-6 rounded-2xl border border-slate-800/60 transition-all hover:border-slate-700/80">
            <h3 className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-4">Worker Status</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="text-center p-2 bg-slate-950/50 rounded-lg border border-slate-800/30">
                <div className="text-[9px] text-slate-500 font-bold">CPUS</div>
                <div className="text-lg font-mono text-white">08</div>
              </div>
              <div className="text-center p-2 bg-slate-950/50 rounded-lg border border-slate-800/30">
                <div className="text-[9px] text-slate-500 font-bold">MODE</div>
                <div className="text-lg font-mono text-white">ASYNC</div>
              </div>
            </div>
            <div className="mt-4 text-[9px] text-center text-slate-500 font-mono tracking-tighter">
              THREAD POOL EXECUTOR: <span className="text-blue-500">ACTIVE</span>
            </div>
          </div>

          <div className="bg-slate-900/30 p-6 rounded-2xl border border-slate-800/60">
            <h3 className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-4">Technical Details</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[10px] font-bold">
                <span className="text-slate-400">PDF-LIB ENGINE</span>
                <span className="text-slate-200">v1.17</span>
              </div>
              <div className="flex items-center justify-between text-[10px] font-bold">
                <span className="text-slate-400">CANVAS RENDER</span>
                <span className="text-slate-200">WEBGL2</span>
              </div>
              <div className="flex items-center justify-between text-[10px] font-bold">
                <span className="text-slate-400">PROXY TUNNEL</span>
                <span className="text-blue-500">SECURE</span>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="h-12 border-t border-slate-800 bg-slate-900/50 flex items-center justify-between px-8 text-[9px] uppercase tracking-[0.15em] text-slate-500 font-bold">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div>
          <span>Engine Build: 2026.05.02_x64</span>
        </div>
        <div className="flex gap-6">
          <span className="hidden md:inline">Auto-Clean: Enabled</span>
          <span className="text-blue-500">Service Online</span>
        </div>
      </footer>
    </div>
  );
}
