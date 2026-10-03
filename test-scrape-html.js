import cheerio from 'cheerio';
async function test() {
  const url = "https://www.slideshare.net/slideshow/aws-intro-ppt/266072124";
  const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
  const response = await fetch(url, {
    headers: {
      "User-Agent": userAgent,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
    },
  });
  const html = await response.text();
  console.log("HTML starts with:", html.substring(0, 100));
  
  const $ = cheerio.load(html);
  const foundUrls = [];
  $("script").each((_, el) => {
      const scriptContent = $(el).html();
      if (scriptContent) {
        const regex = /https:\/\/[^"'\s]+\.slidesharecdn\.com\/[^"'\s]+/gi;
        let m;
        while ((m = regex.exec(scriptContent)) !== null) {
          foundUrls.push(m[0]);
        }
      }
    });

    $("img, source").each((_, el) => {
      const src = $(el).attr("src") || 
                  $(el).attr("srcset") || 
                  $(el).attr("data-src") || 
                  $(el).attr("data-normal") || 
                  $(el).attr("data-full") || 
                  $(el).attr("data-srcset") ||
                  $(el).attr("data-lazy-src");
      if (src) {
        const parts = src.split(",");
        for (const part of parts) {
          const cleanUrl = part.trim().split(" ")[0];
          if (cleanUrl && (cleanUrl.includes("slidesharecdn.com") || cleanUrl.includes("scribdassets.com") || cleanUrl.includes("scribd.com"))) {
            foundUrls.push(cleanUrl);
          }
        }
      }
    });
    console.log("Found URLs:", foundUrls.length);
}
test();
