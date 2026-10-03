import axios from 'axios';
async function test() {
  // Let's just use allorigins to fetch a page and find an image
  const res = await axios.get("https://api.allorigins.win/get?url=" + encodeURIComponent("https://www.slideshare.net/slideshow/aws-architecture/125603845"));
  const html = res.data.contents;
  const match = html.match(/https:\/\/image\.slidesharecdn\.com\/[^"']+\.jpg/gi);
  console.log(match ? match.slice(0, 5) : "no match");
}
test();
