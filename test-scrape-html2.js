import axios from 'axios';
async function test() {
  const url = "http://localhost:3000/api/scrape?url=https://www.slideshare.net/slideshow/aws-intro-ppt/266072124";
  try {
     const response = await fetch(url);
     const json = await response.json();
     console.log(json);
  } catch (e) { console.error(e) }
}
test();
