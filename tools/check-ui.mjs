/* global harness -- set on the page by tools/ui-harness.html and read inside page.evaluate */
import {createServer} from "node:http";
import {readFile, mkdir} from "node:fs/promises";
import {resolve, extname, sep} from "node:path";
import {createRequire} from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.FTAGS_PLAYWRIGHT_PATH || "playwright");
const root = resolve(".");
const server = createServer(async (req, res) => {
  const path = resolve(root, `.${decodeURIComponent(new URL(req.url, "http://localhost").pathname)}`);
  if (!path.startsWith(root + sep)) {res.writeHead(403).end(); return;}
  try {
    const body = await readFile(path);
    res.setHeader("Content-Type", ({".html":"text/html; charset=utf-8",".js":"text/javascript",".css":"text/css",".json":"application/json"})[extname(path)] || "text/plain");
    res.end(body);
  } catch {res.writeHead(404).end();}
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
let browser;
try {
  browser = await chromium.launch({headless:true, ...(process.env.FTAGS_BROWSER_CHANNEL ? {channel:process.env.FTAGS_BROWSER_CHANNEL} : {})});
  const page = await browser.newPage({viewport:{width:1000,height:850}});
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/tools/ui-harness.html`);
  await page.waitForFunction(()=>window.ready);
  await page.locator('[name="newName"]').fill("Проверка звезды");
  await page.locator('[name="newShape"]').selectOption("star");
  await page.locator('[data-action="create"]').click();
  await page.waitForFunction(()=>harness.tagService.listTags().length===1);
  assert.equal(await page.evaluate(()=>harness.tagService.listTags()[0].shape),"star");
  await page.evaluate(()=>{
    foundry.applications.api.DialogV2.wait = async options => {
      if (options.content.querySelector('select[name="shape"] option[selected]')?.value !== 'star') throw new Error('Edit dialog lost the current shape');
      return {name:'Проверка звезды',color:'#D49942',shape:'diamond'};
    };
  });
  await page.locator('[data-action="edit"]').click();
  await page.waitForFunction(()=>harness.tagService.listTags()[0].shape==='diamond');
  assert.equal(await page.evaluate(()=>JSON.parse(harness.tagService.exportDictionary()).tags[0].shape),'diamond');
  await page.locator('.ftags-manager__presets summary').click();
  await page.locator('[data-preset-id="preparation"]').click();
  await page.waitForFunction(()=>harness.tagService.listTags().length===4);
  await page.evaluate(async()=>{
    await harness.manager.render();
    await harness.assignment.render();
    harness.spotlight.query="нежить CR 3";
    harness.spotlight.filtersOpen=true;
    await harness.spotlight.render();
  });
  assert.equal(await page.locator('[data-ftags-result]').count(),1);
  assert.equal(await page.locator('.ftags-spotlight__result .ftags-chip').count(),0);
  assert.equal(await page.locator('.ftags-assignment [name="tagIds"]').count(),4);
  assert.ok(await page.locator('[data-tag-id="auto-dnd5e-cr-3"]').count());
  const markers = await page.evaluate(async()=>{
    const {enhanceDirectory} = await import('/scripts/ui/directory-enhancer.js');
    harness.actor.flags={ftags:{tagIds:harness.tagService.listTags().map(tag=>tag.id)}};
    const root=document.createElement('section');
    root.innerHTML='<ol class="directory-list"><li class="directory-item document" data-entry-id="skeleton"><span class="entry-name">Скелет</span></li></ol>';
    document.querySelector('#mount').append(root);
    await enhanceDirectory({documentName:'Actor',collection:new Map([['skeleton',harness.actor]])},root);
    const markers=[...root.querySelectorAll('.ftags-tag-strip')].map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}));
    root.remove();return markers;
  });
  assert.equal(markers.length,4);
  assert.ok(markers.every(marker=>marker.width===6 && marker.height===6),'Directory shapes and overflow must stay 6px');
  await page.evaluate(async()=>{await harness.manager.close();await harness.assignment.close();});
  await page.locator('.ftags-spotlight__automatic summary').click();
  await mkdir("artifacts",{recursive:true});
  await page.screenshot({path:"artifacts/spotlight.png",fullPage:true});
  await page.evaluate(async()=>{await harness.spotlight.close();await harness.manager.render();});
  await page.locator('.ftags-manager__presets summary').click();
  await page.screenshot({path:"artifacts/tag-manager.png",fullPage:true});
  await page.setViewportSize({width:420,height:850});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth), "Manager must fit narrow viewport");
  await page.screenshot({path:"artifacts/tag-manager-narrow.png",fullPage:true});
  await page.evaluate(()=>{game.user.isGM=false;});
  assert.equal(await page.evaluate(()=>harness.manager._canRender({})),false);
  assert.deepEqual(errors,[]);
  console.log("UI harness passed: create/edit/export shape, preset, automatic search, hidden automatic chips/assignments, filters, 6px directory markers and overflow, narrow layout, GM-only rendering.");
} finally {await browser?.close();await new Promise(done=>server.close(done));}
