import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { validateManifest } from "../tools/release-manifest.mjs";

const root = new URL("../", import.meta.url);
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"));

/** The keys Foundry's PackageRelationships schema keeps; anything else is dropped without a warning. */
const RELATIONSHIP_KEYS = ["systems", "requires", "recommends", "conflicts", "flags"];

test("package.json and module.json carry one version", async () => {
  const [manifest, pkg] = await Promise.all([readJson("module.json"), readJson("package.json")]);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.version, manifest.version);
});

test("the shipped manifest passes the release rules", async () => {
  const [manifest, pkg] = await Promise.all([readJson("module.json"), readJson("package.json")]);
  const options = { version: pkg.version, repository: manifest.url ?? "", exists: (file) => existsSync(new URL(file, root)) };
  assert.deepEqual(validateManifest(manifest, options), []);
  const withoutPrefix = { ...manifest, download: manifest.download.replace("/v", "/") };
  assert.ok(
    validateManifest(withoutPrefix, options).some((problem) => problem.startsWith("download must be")),
    "a download URL without the v prefix is rejected"
  );
});

test("compatibility is bounded to the verified core generation", async () => {
  const { compatibility } = await readJson("module.json");
  assert.ok(compatibility.minimum, "compatibility.minimum");
  assert.ok(compatibility.verified, "compatibility.verified");
  assert.equal(compatibility.maximum, String(compatibility.verified).split(".")[0]);
});

test("relationships use only keys Foundry understands", async () => {
  const { relationships = {} } = await readJson("module.json");
  for (const key of Object.keys(relationships)) assert.ok(RELATIONSHIP_KEYS.includes(key), `relationships.${key}`);
});

test("every listed file exists and both languages ship", async () => {
  const manifest = await readJson("module.json");
  const files = [...manifest.esmodules, ...(manifest.styles ?? []), ...manifest.languages.map((language) => language.path)];
  for (const file of files) assert.ok(existsSync(new URL(file, root)), file);
  assert.deepEqual(manifest.languages.map((language) => language.lang).sort(), ["en", "ru"]);
  assert.ok(manifest.languages.every((language) => language.path.startsWith("lang/")), "languages live in lang/");
});
