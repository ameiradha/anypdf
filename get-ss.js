import * as cheerio from 'cheerio';
async function run() {
  const res = await fetch("https://www.slideshare.net/search?q=aws");
  const html = await res.text();
  const $ = cheerio.load(html);
  const nextData = $("#__NEXT_DATA__").html();
  if (nextData) {
     const data = JSON.parse(nextData);
     const results = data.props?.pageProps?.searchResults || [];
     console.log(results.map(r => r.url).slice(0, 3));
  } else {
     console.log("no next data");
     // try extracting hrefs manually
     const hrefs = [];
     $("a").each((i, el) => {
        const href = $(el).attr("href");
        if (href && href.includes("/slideshow/")) hrefs.push(href);
     });
     console.log("Hrefs:", hrefs.slice(0, 3));
  }
}
run();
