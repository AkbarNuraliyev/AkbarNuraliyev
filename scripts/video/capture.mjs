// Captures the screens for the role tutorial videos from a running PoultryOS instance.
// Usage: BASE_URL=http://localhost:3200 node scripts/video/capture.mjs <outDir> [roleKey...]
// Run it against a COPY of the demo database (see prep-video-db.ts): some steps perform real actions.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { ROLES } from "./storyboards.mjs";

const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const BASE = process.env.BASE_URL || "http://localhost:3200";
const outDir = process.argv[2];
const only = process.argv.slice(3);
if (!outDir) throw new Error("usage: capture.mjs <outDir> [roleKey...]");

// Text that may legitimately stay Latin on a Russian screen.
const ALLOWED = /^(PoultryOS|SAFI( Demo)?|CSV|Excel|OTIF|FEFO|HACCP|B2B|QR|API|REST|UZS|kg|t|RU|UZ|EN|Didox|Faktura\.uz|1C.*|Smartup.*|Wialon|BILLZ|FoodMate.*|Marel|MES|CAPA|STARTER|GROWTH|ENTERPRISE|Enterprise|Growth|Starter|OpenAPI|ROI)$/;
const CODE = /(SAFI-|SO-|SHP-|RCV-|SH-|INV-|STK-|TRF-|FARM\d|@|\(demo\)|\d)/;

async function englishOnScreen(p) {
  return p.evaluate(() => {
    const out = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const vh = window.innerHeight;
    while (walker.nextNode()) {
      const n = walker.currentNode;
      const s = n.textContent.trim().replace(/\s+/g, " ");
      if (!s || !/[A-Za-z]{3,}/.test(s) || /[А-Яа-яЁё]/.test(s)) continue;
      const el = n.parentElement;
      if (!el || el.closest("script,style,svg")) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.bottom < 0 || r.top > vh) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      out.add(s);
    }
    for (const el of document.querySelectorAll("input[placeholder],textarea[placeholder]")) {
      const s = el.getAttribute("placeholder");
      if (/[A-Za-z]{3,}/.test(s) && !/[А-Яа-я]/.test(s)) out.add(s);
    }
    return [...out];
  });
}

const browser = await chromium.launch();
const english = new Map();
for (const role of ROLES) {
  if (only.length && !only.includes(role.key)) continue;
  const dir = path.join(outDir, role.key);
  fs.mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({ ...(role.mobile ? devices["iPhone 13"] : { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 }), locale: "ru-RU", timezoneId: "Asia/Tashkent" });
  await ctx.addCookies([{ name: "pos_locale", value: "ru", url: BASE }]);
  const p = await ctx.newPage();
  const vp = p.viewportSize();
  const steps = [];
  let i = 0;
  for (const s of role.steps) {
    i++;
    const tag = `${role.key} #${i}`;
    let error = null;
    let box = null;
    try {
      if (s.go) {
        await p.goto(BASE + s.go, { waitUntil: "networkidle" });
      }
      if (s.before) await s.before(p);
      await p.waitForTimeout(500);
      await p.mouse.move(vp.width - 2, vp.height - 2);
      if (s.target) {
        const loc = p.locator(s.target).first();
        await loc.waitFor({ state: "visible", timeout: 8000 });
        await loc.scrollIntoViewIfNeeded();
        // Tall elements (tables, long cards): show their top part under the sticky header.
        await loc.evaluate((el) => {
          const r = el.getBoundingClientRect();
          if (r.height > window.innerHeight * 0.55) window.scrollBy(0, r.top - 72);
        });
        await p.waitForTimeout(300);
        const b = await loc.boundingBox();
        if (b) {
          const pad = s.pad ?? 8;
          const x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad);
          box = { x, y, w: Math.min(vp.width, b.x + b.width + pad) - x, h: Math.min(vp.height, b.y + b.height + pad) - y };
        }
      }
    } catch (e) {
      error = e.message.split("\n")[0];
      console.log(`FAIL ${tag}: ${error}`);
    }
    const file = `${String(i).padStart(2, "0")}.png`;
    await p.screenshot({ path: path.join(dir, file) });
    for (const t of await englishOnScreen(p)) {
      if (ALLOWED.test(t) || CODE.test(t)) continue;
      if (!english.has(t)) english.set(t, `${role.key} ${s.go ?? ""}`);
    }
    steps.push({ image: `${role.key}/${file}`, box, caption: s.caption, say: s.say, error });
    if (!error && s.after) {
      try {
        await s.after(p);
      } catch (e) {
        console.log(`FAIL ${tag} (after): ${e.message.split("\n")[0]}`);
        steps[steps.length - 1].error = "after: " + e.message.split("\n")[0];
      }
    }
    console.log(`${error ? "ERR " : "ok  "} ${tag} ${box ? `${Math.round(box.w)}x${Math.round(box.h)}` : "no-box"}`);
  }
  const manifest = { key: role.key, title: role.title, emoji: role.emoji, who: role.who, email: role.email, mobile: !!role.mobile, viewport: vp, intro: role.intro, outro: role.outro, points: role.points, steps };
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  await ctx.close();
}
await browser.close();
fs.writeFileSync(path.join(outDir, "english-strings.json"), JSON.stringify(Object.fromEntries(english), null, 2));
console.log(`\n${english.size} untranslated strings on screen → english-strings.json`);
