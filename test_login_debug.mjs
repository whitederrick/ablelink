import { chromium } from "./node_modules/playwright/index.mjs";
const BASE = "http://localhost:3000";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox","--disable-gpu"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

page.on("request", req => {
  if (req.url().includes("login") || req.url().includes("auth")) {
    console.log("REQ:", req.method(), req.url().replace(BASE, ""));
  }
});
page.on("response", resp => {
  if (resp.url().includes("login") || resp.url().includes("auth")) {
    console.log("RES:", resp.status(), resp.url().replace(BASE, ""));
  }
});

await page.goto(BASE + "/admin/login", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1000);

const inputs = await page.locator("input").count();
console.log("inputs:", inputs);
const placeholders = await page.locator("input").evaluateAll(el => el.map(i => i.placeholder));
console.log("placeholders:", placeholders);

await page.locator("input[placeholder*='아이디']").fill("admin");
await page.locator("input[type=password]").fill("admin1234!");
console.log("filled");

await page.screenshot({ path: "C:/tmp/admin_debug_filled.png" });

const submitBtns = await page.locator("button[type=submit], button:has-text('로그인')").count();
console.log("submit buttons:", submitBtns);

await page.locator("button[type=submit], button:has-text('로그인')").first().click();
await page.waitForTimeout(3000);
console.log("after click URL:", page.url());
await page.screenshot({ path: "C:/tmp/admin_debug_after.png" });

await browser.close();
