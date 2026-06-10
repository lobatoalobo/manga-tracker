import * as cheerio from "cheerio";

async function main() {
  const response = await fetch(
    "https://www.ivrea.com.ar/catalogo/",
  );

  const html = await response.text();

  const $ = cheerio.load(html);

  const searchTerms = [
    "blame",
    "berserk",
  ];

  for (const term of searchTerms) {
    console.log("\n======", term, "======");

    $("a").each((_, element) => {
      const href = $(element).attr("href");
      const text = $(element).text().trim();

      const haystack = (
        text +
        " " +
        (href ?? "")
      ).toLowerCase();

      if (haystack.includes(term)) {
        console.log({
          text,
          href,
        });
      }
    });
  }
}

main();