/** Rendered-or-rendering instances of an ApplicationV2 subclass. */
export function findAppInstances(AppClass) {
  const registry = foundry.applications?.instances;
  if (!registry) return [];
  return [...registry.values()].filter((app) => app instanceof AppClass);
}

/**
 * Applications with a fixed id must not be rendered twice: a second instance would take over the
 * DOM node and the registry slot while the first one stays half alive. Returns the instance that
 * already owns the id, after bringing it forward, or null when `app` may render itself.
 */
export function focusExistingInstance(app) {
  const existing = foundry.applications?.instances?.get(app.id);
  if (!existing || existing === app || !existing.rendered || !existing.element?.isConnected) return null;
  if (existing.minimized) void existing.maximize();
  existing.bringToFront();
  return existing;
}

export function asElement(value) {
  if (value instanceof HTMLElement) return value;
  return value?.[0] instanceof HTMLElement ? value[0] : null;
}

/** Keep a value usable inside an element id. */
export function idFragment(value) {
  return String(value ?? "").replace(/[^A-Za-z0-9_-]/g, "-");
}
