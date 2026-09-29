import {readFile, readdir} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import assert from "node:assert/strict";
import {resolve} from "node:path";
import Handlebars from "handlebars";

async function files(directory) {
  const entries = await readdir(directory, {withFileTypes: true});
  return (await Promise.all(entries.map(entry => entry.isDirectory()
    ? files(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]))).flat();
}
const sources = [...await files("scripts"), ...await files("tests"), ...await files("tools")].filter(path => /\.m?js$/.test(path));
for (const path of sources) {
  const result = spawnSync(process.execPath, ["--check", resolve(path)], {encoding: "utf8"});
  assert.equal(result.status, 0, `${path}: ${result.stderr}`);
}
/** Nested language files read as dotted keys, the way Foundry resolves them. */
function flatten(tree, prefix = "", into = {}) {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") flatten(value, path, into);
    else into[path] = value;
  }
  return into;
}
const en = flatten(JSON.parse(await readFile("lang/en.json", "utf8")));
const ru = flatten(JSON.parse(await readFile("lang/ru.json", "utf8")));
assert.deepEqual(Object.keys(en).sort(), Object.keys(ru).sort(), "Localization keys differ");
for (const key of Object.keys(en)) {
  assert.deepEqual(en[key].match(/\{\w+\}/g)?.sort() ?? [], ru[key].match(/\{\w+\}/g)?.sort() ?? [], `Placeholder mismatch: ${key}`);
}
const templates = await files("templates");
for (const path of templates) Handlebars.precompile(await readFile(path, "utf8"));
for (const file of [...sources, ...templates]) {
  const source = await readFile(file, "utf8");
  for (const [, key] of source.matchAll(/["'](FTAGS\.[A-Za-z0-9_.]+)["']/g)) {
    assert.ok(Object.hasOwn(en, key), `${file}: missing translation ${key}`);
  }
}
const manifest = JSON.parse(await readFile("module.json", "utf8"));
assert.equal(manifest.id, "ftags");
for (const path of [...manifest.esmodules, ...manifest.styles, ...manifest.languages.map(l => l.path)]) await readFile(path);
console.log(`Validated ${sources.length} scripts, compiled ${templates.length} templates and checked ${Object.keys(en).length} localization keys.`);
