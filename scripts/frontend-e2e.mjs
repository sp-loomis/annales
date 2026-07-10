// Deeper E2E pass: edit → type prose → save → verify read mode + API persistence;
// search; dirty-guard dialog. Run with dev servers up and seeded data.
import { chromium } from "playwright";

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

const ok = (name, cond) => console.log(`${cond ? "PASS" : "FAIL"} ${name}`);

await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForTimeout(1000);

// -- 1. New opens untitled editor directly (no modal)
await page.getByTestId("new-entry-button").click();
await page.waitForTimeout(700);
ok("new opens editor directly", (await page.getByTestId("entry-save").count()) === 1);
ok("new entry dialog is not shown", (await page.getByTestId("new-entry-title").count()) === 0);
ok(
  "untitled starts with empty internal title",
  (await page.getByTestId("entry-title-input").inputValue()) === ""
);
await page.getByTestId("entry-cancel").click();
await page.waitForTimeout(500);

// -- 2. search narrows results
await page.getByTestId("search-input").fill("Ilyana");
await page.waitForTimeout(900);
const searchCount = await page.locator('[data-testid^="result-"]').count();
ok("search narrows to 1 result", searchCount === 1);

// -- 3. open entry, enter edit mode
await page.locator('[data-testid^="result-"]').first().click();
await page.waitForTimeout(800);
await page.getByTestId("entry-edit").click();
await page.waitForTimeout(400);
ok("edit mode shows save", (await page.getByTestId("entry-save").count()) === 1);

// -- 4. add a section via insert picker, type prose
await page.locator('[data-testid^="insert-after-"]').last().click({ force: true });
await page.getByTestId("insert-picker-section").click();
await page.waitForTimeout(300);
const editor = page.locator(".tiptap").last();
await editor.click();
await page.keyboard.type("The archmage of the eastern reaches.");
await page.waitForTimeout(600);

// -- 5. dirty state: tab shows dot; try closing → discard dialog appears
const ilyanaTab = page.locator('[data-testid^="tab-"]').filter({ hasText: "Ilyana" }).last();
await ilyanaTab.locator('[data-testid^="tab-close-"]').click();
await page.waitForTimeout(300);
const dialogVisible = (await page.getByTestId("discard-confirm").count()) === 1;
ok("dirty close shows discard dialog", dialogVisible);
if (dialogVisible) await page.getByTestId("discard-cancel").click();
await page.waitForTimeout(300);

// -- 6. save, verify read mode renders the prose
await page.getByTestId("entry-save").click();
await page.waitForTimeout(1500);
const readBody = await page.locator("article").innerText();
ok("saved prose renders in read mode", readBody.includes("archmage of the eastern reaches"));
ok("back in read mode (edit button present)", (await page.getByTestId("entry-edit").count()) === 1);

// -- 7. persisted server-side?
const worldsRes = await fetch("http://localhost:3000/worlds").then((r) => r.json());
const world = worldsRes.items.find((w) => w.name === "Eldermoor");
const entries = await fetch(`http://localhost:3000/worlds/${world.id}/entries`).then((r) =>
  r.json()
);
const ilyana = entries.items.find((e) => e.title.includes("Ilyana"));
const detail = await fetch(`http://localhost:3000/entries/${ilyana.id}`).then((r) => r.json());
const sectionText = JSON.stringify(detail.sections);
ok("section persisted via API", sectionText.includes("archmage of the eastern reaches"));

// -- 8. reload restores tabs
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1200);
ok("tabs restored after reload", (await page.locator('[data-testid^="tab-"]').count()) >= 1);

await page.screenshot({ path: "/tmp/sheaf-e2e.png" });
console.log("console errors:", JSON.stringify(errors.slice(0, 5), null, 2));
await browser.close();
