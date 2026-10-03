import * as cheerio from 'cheerio';

async function test() {
  const url = "https://www.slideshare.net/slideshow/aws-intro-ppt/266072124";
  const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
  const response = await fetch(url, {
    headers: {
      "User-Agent": userAgent,
    },
  });
  const html = await response.text();
  const $ = cheerio.load(html);
  const nextDataStr = $("#__NEXT_DATA__").html();
  if (nextDataStr) {
    const data = JSON.parse(nextDataStr);
    const slides = data.props?.pageProps?.slideshow?.slides || [];
    if (slides.length > 0) {
       console.log("Found slides array! First slide:", slides[0].image_url);
    } else {
       console.log("Could not find slides array in NEXT_DATA");
    }
  } else {
    console.log("Could not find __NEXT_DATA__");
  }
}
test();
