import fs from 'fs';
async function test() {
   const res = await fetch("http://www.slideshare.net/EDMdesigner/how-to-optimize-your-confirmation-email-design-and-make-it-bring-you-more-sales");
   const html = await res.text();
   const regex = /https:\/\/[^"'\s<>]+?\.slidesharecdn\.com\/[^"'\s<>]+\.(jpg|jpeg|png|webp)[^"'\s<>]*/gi;
   console.log(html.match(regex));
}
test();
