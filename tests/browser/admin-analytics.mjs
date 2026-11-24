import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createServerClient } from "@supabase/ssr";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const app = process.env.QA_APP_URL || "http://127.0.0.1:55420";
const gatewayPort = process.env.QA_GATEWAY_PORT || "55423";
assert.match(gatewayPort, /^\d{1,5}$/);
const gateway = `http://127.0.0.1:${gatewayPort}`;
const screenshots = process.env.QA_SCREENSHOTS || "/tmp/mafia-admin-analytics-qa";
const stack = process.env.QA_STACK_NAME || "mafia-engineering-b";
const db = stack + "-db";
assert.match(app, /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/, "Run against the local synthetic app.");
assert.match(stack, /^mafia-[a-z0-9-]+$/);

function docker(args, input) {
  const result = spawnSync("docker", args, { input, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr?.trim() || result.error?.message);
  return result.stdout.trim();
}

assert.equal(docker(["inspect", "--format", '{{index .Config.Labels "mafia.synthetic"}}', db]), stack);
const day = docker(["exec", "-i", db, "psql", "-qXAt", "-U", "postgres", "-v", "ON_ERROR_STOP=1"], `
  begin;
  insert into public.evenings(id,starts_at,place,status) values
    ('87000000-0000-4000-8000-000000000001',(current_date-61+time '19:00') at time zone 'Europe/Vienna','Тест · Analytics','finished'),
    ('87000000-0000-4000-8000-000000000002',(current_date-56+time '19:00') at time zone 'Europe/Vienna','Тест · Analytics','finished'),
    ('87000000-0000-4000-8000-000000000003',(current_date-11+time '19:00') at time zone 'Europe/Vienna','Тест · Analytics','finished'),
    ('87000000-0000-4000-8000-000000000004',(current_date-6+time '19:00') at time zone 'Europe/Vienna','Тест · Analytics','finished')
  on conflict do nothing;
  insert into public.evening_attendance_logs(evening_id) values
    ('87000000-0000-4000-8000-000000000001'),
    ('87000000-0000-4000-8000-000000000002'),
    ('87000000-0000-4000-8000-000000000003')
  on conflict do nothing;
  insert into public.evening_attendees(evening_id,player_id) values
    ('87000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000101'),
    ('87000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000104'),
    ('87000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000101'),
    ('87000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000105')
  on conflict do nothing;
  insert into public.evening_signups(evening_id,player_id,status) values
    ('87000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000101','late'),
    ('87000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000105','going'),
    ('87000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000106','going')
  on conflict do nothing;
  commit;
  select (starts_at at time zone 'Europe/Vienna')::date
    from public.evenings where id = '87000000-0000-4000-8000-000000000002';
`);
assert.match(day, /^\d{4}-\d{2}-\d{2}$/);

async function authenticate(context, email) {
  const values = new Map();
  const client = createServerClient(gateway, "synthetic-browser-test", {
    cookies: {
      getAll: () => [...values].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) values.set(name, value);
      },
    },
  });
  const { error } = await client.auth.signInWithPassword({
    email, password: process.env.QA_PASSWORD || "Synthetic-QA-Only-2026",
  });
  assert.equal(error, null);
  await context.addCookies([...values].map(([name, value]) => ({ name, value, url: app })));
}

const wait = { waitUntil: "commit", timeout: 60_000 };
const checkOverflow = async (page) => {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Horizontal overflow at ${page.viewportSize().width}px`);
};
await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] });

try {
  const guest = await browser.newPage();
  await guest.goto(app + "/admin/analytics", wait);
  await guest.waitForURL("**/login", wait);
  await guest.close();

  const playerContext = await browser.newContext();
  await authenticate(playerContext, process.env.QA_PLAYER_EMAIL || "qa-player@example.test");
  const player = await playerContext.newPage();
  await player.goto(app + "/admin/analytics", wait);
  await player.waitForURL("**/login?error=forbidden", wait);
  await playerContext.close();

  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU" });
  await authenticate(adminContext, process.env.QA_ADMIN_EMAIL || "qa-admin@example.test");
  const admin = await adminContext.newPage();
  await admin.goto(app + "/admin/analytics", wait);
  await admin.getByRole("heading", { name: "Аналитика клуба" }).waitFor();
  await admin.getByRole("heading", { name: "Фактическая посещаемость" }).waitFor();
  assert(await admin.getByText("Визитов по журналу · 0", { exact: true }).count());
  assert(await admin.getByText("Журнал отсутствует", { exact: true }).count());
  const definitions = admin.getByText("Как считаются показатели", { exact: true });
  await definitions.click();
  assert(await admin.getByText("Один человек может").isVisible());
  await definitions.click();

  for (const [width, height, device] of [[1440, 1000, "desktop"], [820, 1180, "ipad-portrait"], [375, 812, "phone"]]) {
    await admin.setViewportSize({ width, height });
    await admin.evaluate(() => new Promise((done) => {
      window.scrollTo(0, 0);
      requestAnimationFrame(() => requestAnimationFrame(done));
    }));
    await checkOverflow(admin);
    await admin.screenshot({ path: resolve(screenshots, `admin-analytics-${device}.png`), fullPage: true, animations: "disabled" });
  }

  await admin.getByLabel("С какого дня").fill(day);
  await admin.getByLabel("По какой день").fill(day);
  await admin.getByRole("button", { name: "Показать" }).click();
  await admin.waitForURL(`**/admin/analytics?from=${day}&to=${day}`, wait);
  const matchingSignup = admin.getByText("Пришли по подтверждённой записи", { exact: true }).locator("..");
  await matchingSignup.waitFor();
  assert.match(await matchingSignup.textContent(), /2 \/ 3/);

  await admin.goto(app + "/admin/analytics?from=2024-01-01&to=2024-01-31", wait);
  await admin.getByText("В календаре нет вечеров за выбранный период.").waitFor();
  const average = admin.getByText("В среднем визитов на вечер с журналом", { exact: true }).locator("..");
  assert.match(await average.textContent(), /—/);

  await adminContext.addCookies([{ name: "mafia-locale", value: "uk", url: app }]);
  await admin.goto(app + "/admin/analytics?from=2024-01-31&to=2024-01-01", wait);
  await admin.getByRole("heading", { name: "Аналітика клубу" }).waitFor();
  await admin.getByText("Вкажіть коректний період").waitFor();
  await admin.getByRole("heading", { name: "Фактична відвідуваність" }).waitFor();
  await checkOverflow(admin);
  await admin.screenshot({ path: resolve(screenshots, "admin-analytics-phone-uk.png"), fullPage: true, animations: "disabled" });
  console.log("Analytics in Chromium: roles, dates, roster coverage, RSVP matching, RU/UK and three viewport widths passed.");
} finally {
  await browser.close();
}
