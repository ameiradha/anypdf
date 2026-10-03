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
    console.log(JSON.stringify(data).substring(0, 500));
  } else {
    console.log("No NEXT_DATA");
  }
}
run();
