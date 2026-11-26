import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const app = process.env.QA_APP_URL ?? "http://127.0.0.1:55420";
const gateway = process.env.QA_METRICS_URL;
const artifacts = resolve(process.env.QA_SCREENSHOTS ?? ".next/pre-release-qa");
const baseline = process.env.QA_LAYOUT_BASELINE === "1";
const layoutOnly = process.env.QA_LAYOUT_ONLY === "1";
const evening = `/evenings/${process.env.QA_LAYOUT_EVENING_ID ?? "00000000-0000-0000-0000-0000000000e1"}`;
const loopback = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/;
assert.match(app, loopback);
if (gateway) assert.match(gateway, loopback);
await mkdir(artifacts, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  headless: true,
  args: ["--disable-background-networking"],
});
const sizes = [[360, 800], [390, 844], [400, 900], [430, 932], [768, 1024], [820, 1180], [1024, 768], [1440, 1000]];
const routes = ["/", "/evenings", evening, "/players", "/rating", "/history", "/referee"];
const metrics = [];
const layout = [];

async function login(page, email) {
  await page.goto(app + "/login");
  const form = page.locator("main form:visible");
  await form.locator("#email").fill(email);
  await form.locator("#password").fill(process.env.QA_PASSWORD ?? "Synthetic-QA-Only-2026");
  await form.getByRole("button", { name: "Войти", exact: true }).click();
  await page.waitForURL((url) => url.pathname !== "/login");
}

async function visit(page, path) {
  const response = await page.goto(app + path);
  assert.equal(response?.status(), 200, path);
  await page.locator(path === "/referee" ? ".ref-setup:visible" : "main h1:visible").first().waitFor();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

async function measureBox(page, path, width, role) {
  const result = await page.evaluate(() => {
    const root = document.documentElement;
    const header = document.querySelector("header");
    const view = root.clientWidth;
    const candidates = Array.from(document.querySelectorAll("body *")).flatMap((node) => {
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.right <= view + 1 || node.closest(".overflow-x-auto,[aria-hidden=true]")) return [];
      return [{ tag: node.tagName, right: Math.round(rect.right), class: node.getAttribute("class")?.slice(0, 130) }];
    });
    const controls = Array.from(header?.querySelectorAll("a,button") ?? []).flatMap((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      if (!rect.width || !rect.height || style.visibility !== "visible") return [];
      const hit = document.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
      return rect.right <= view + 1 && node.contains(hit) ? [] : [{ label: node.getAttribute("aria-label") ?? node.textContent?.trim(), right: Math.round(rect.right) }];
    });
    return { viewport: innerWidth, scrollWidth: root.scrollWidth, clientWidth: view, candidates: candidates.slice(0, 10), controls };
  });
  layout.push({ path, width, role, ...result });
}

async function readGateway() {
  if (!gateway) return {};
  const response = await fetch(gateway + "/__qa_metrics");
  assert.equal(response.status, 200);
  return response.json();
}

async function performanceSample(page, path, role) {
  const requests = [];
  const listener = (request) => {
    if (new URL(request.url()).origin === app) requests.push(request.resourceType());
  };
  const before = await readGateway();
  page.on("request", listener);
  try {
    await visit(page, path);
    const data = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      return { ttfb: Math.round(nav.responseStart - nav.startTime), load: Math.round(nav.loadEventEnd - nav.startTime) };
    });
    const after = await readGateway();
    const backend = Object.fromEntries(Object.keys(after).map((key) => [key, after[key] - (before[key] ?? 0)]).filter(([, count]) => count));
    metrics.push({ path, role, ...data, requests: requests.length, backend });
  } finally { page.off("request", listener); }
}

try {
  const guest = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const guestPage = await guest.newPage();
  const owner = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const ownerPage = await owner.newPage();
  await login(ownerPage, process.env.QA_ADMIN_EMAIL ?? "qa-admin@example.test");

  for (const [role, page] of [["guest", guestPage], ["admin", ownerPage]]) {
    if (!layoutOnly) {
      for (let sample = 0; sample < 5; sample++) {
        for (const path of ["/", evening, "/rating", "/players", "/referee"]) {
          await performanceSample(page, path, role);
        }
      }
    }
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      for (const path of role === "guest" ? routes : [...routes.filter((route) => route !== "/referee"), "/admin"]) {
        await visit(page, path);
        await measureBox(page, path, width, role);
        if (path === evening && [400, 768, 1440].includes(width)) {
          await page.screenshot({ path: resolve(artifacts, `${baseline ? "before" : "after"}-${role}-evening-${width}.png`) });
        }
        if (!baseline && role === "admin" && path === evening && width === 768) {
          await page.getByRole("button", { name: "Открыть меню", exact: true }).click();
          await page.locator("#mobile-menu").getByRole("link", { name: "Админка", exact: true }).waitFor();
          await page.keyboard.press("Escape");
          await page.locator("#mobile-menu").waitFor({ state: "hidden" });
        }
      }
    }
  }

  const player = await browser.newContext();
  const playerPage = await player.newPage();
  await login(playerPage, process.env.QA_PLAYER_EMAIL ?? "qa-player@example.test");
  for (const path of ["/admin", "/admin/referee/inbox", "/admin/communications", "/admin/analytics"]) {
    await playerPage.goto(app + path);
    await playerPage.waitForURL((url) => url.pathname === "/login");
    assert.equal(new URL(playerPage.url()).searchParams.get("error"), "forbidden");
  }
  await playerPage.goto(app + "/club/preferences");
  await playerPage.locator("main h1").waitFor();
  assert(new URL(playerPage.url()).pathname === "/club/preferences");
  await guestPage.goto(app + "/admin/referee/inbox");
  await guestPage.waitForURL((url) => url.pathname === "/login");
} finally {
  await browser.close();
  const file = baseline ? "pre-release-before.json" : layoutOnly ? "pre-release-layout-final.json" : "pre-release-after.json";
  await writeFile(resolve(artifacts, file), JSON.stringify({ layout, metrics }, null, 2) + "\n");
}

const failures = layout.filter((run) => run.scrollWidth > run.clientWidth + 1 || run.controls.length);
const summary = failures.map(({ path, role, width, scrollWidth, controls }) => ({ path, role, width, scrollWidth, controls: controls.map(({ label }) => label) }));
console.log(JSON.stringify({ pages: layout.length, performanceSamples: metrics.length, failures: summary }, null, 2));
if (!baseline) assert.equal(failures.length, 0, "Routes or navigation controls overflow");
