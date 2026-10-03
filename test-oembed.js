async function run() {
  const oembedUrl = `https://www.slideshare.net/api/oembed/2?url=${encodeURIComponent("http://www.slideshare.net/EDMdesigner/how-to-optimize-your-confirmation-email-design-and-make-it-bring-you-more-sales")}&format=json`;
  const oembedResponse = await fetch(oembedUrl);
  const data = await oembedResponse.json();
  console.log("slide_image_baseurl:", data.slide_image_baseurl);
  console.log("slide_image_baseurl_suffix:", data.slide_image_baseurl_suffix);
}
run();
