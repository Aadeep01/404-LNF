import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser } from "playwright";
import { extractSegments } from "./crawler";

describe("generic DOM extraction", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser.close();
  });

  test("captures rendered text and translatable attributes while excluding unsafe content", async () => {
    const page = await browser.newPage();
    await page.setContent(`
      <html lang="en">
        <head><title>Local demo</title><meta name="description" content="A demo description"></head>
        <body>
          <main id="app">
            <h1>Welcome to the demo</h1>
            <p id="dynamic"></p>
            <input placeholder="Enter your email" />
            <img alt="A product illustration" />
            <p translate="no">Protected Brand</p>
            <script>document.querySelector('#dynamic').textContent = 'Loaded after JavaScript';</script>
            <code>const secret = true</code>
          </main>
        </body>
      </html>
    `);

    const segments = await extractSegments(page);
    const texts = segments.map((segment) => segment.sourceText);

    expect(texts).toContain("Welcome to the demo");
    expect(texts).toContain("Loaded after JavaScript");
    expect(texts).toContain("Enter your email");
    expect(texts).toContain("A product illustration");
    expect(texts).toContain("Local demo");
    expect(texts).toContain("A demo description");
    expect(texts).not.toContain("Protected Brand");
    expect(texts).not.toContain("const secret = true");
    await page.close();
  });
});
