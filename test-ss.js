import * as cheerio from 'cheerio';
async function run() {
  const res = await fetch("https://www.slideshare.net/slideshow/aws-architecture/125603845", {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
  });
  const html = await res.text();
  const $ = cheerio.load(html);
  const nextData = $("#__NEXT_DATA__").html();
  if (nextData) {
    const data = JSON.parse(nextData);
    const ss = data.props?.pageProps?.slideshow;
    if (ss) {
       console.log("pin_image_url:", ss.pin_image_url);
       console.log("slides count:", ss.slides?.length);
       if (ss.slides?.length > 0) console.log(ss.slides[0]);
    } else {
       console.log("No slideshow found in NEXT_DATA");
       console.log(Object.keys(data.props?.pageProps || {}));
    }
  } else {
    console.log("No NEXT_DATA");
  }
}
run();
