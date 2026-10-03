async function test() {
  try {
    const res = await fetch("https://www.slideshare.net/slideshow/aws-intro-ppt/266072124", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      }
    });
    const html = await res.text();
    console.log(html.substring(0, 200));
    console.log("Has NEXT_DATA:", html.includes("__NEXT_DATA__"));
  } catch (e) {
    console.error(e.message);
  }
}
test();
