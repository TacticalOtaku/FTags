const COMBINING_MARKS = /[\u0300-\u036f]/g;

export function foldSearchText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function buildSpotlightIndex(records) {
  return records
    .filter((record) => Array.isArray(record?.tags) && record.tags.length)
    .map((record, order) => ({
      ...record,
      _spotlight: {
        order,
        name: foldSearchText(record.name),
        tags: record.tags.map((tag) => foldSearchText(tag.name)).filter(Boolean)
      }
    }));
}

export function searchSpotlightIndex(index, query, {limit = 100} = {}) {
  const tokens = tokenizeQuery(query);
  const safeLimit = Math.max(0, Number.isFinite(limit) ? Math.trunc(limit) : 100);
  const matches = [];

  for (const record of index ?? []) {
    const search = record?._spotlight ?? {
      order: matches.length,
      name: foldSearchText(record?.name),
      tags: (record?.tags ?? []).map((tag) => foldSearchText(tag.name)).filter(Boolean)
    };
    let score = 0;
    let matched = true;

    for (const token of tokens) {
      const tokenScore = scoreToken(search, token);
      if (tokenScore === null) {
        matched = false;
        break;
      }
      score += tokenScore;
    }
    if (matched) matches.push({record, score, search});
  }

  return matches
    .sort((left, right) => (
      left.score - right.score
      || left.search.name.localeCompare(right.search.name)
      || String(left.record.entityType ?? "").localeCompare(String(right.record.entityType ?? ""))
      || left.search.order - right.search.order
    ))
    .slice(0, safeLimit)
    .map(({record}) => record);
}

function tokenizeQuery(query) {
  return String(query ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => {
      const tagOnly = raw.startsWith("#");
      return {tagOnly, value: foldSearchText(tagOnly ? raw.slice(1) : raw)};
    })
    .filter((token) => token.value);
}

function scoreToken(search, token) {
  const candidates = [];
  if (!token.tagOnly) candidates.push(scoreValue(search.name, token.value, 0));
  for (const tag of search.tags) candidates.push(scoreValue(tag, token.value, token.tagOnly ? 0 : 40));
  const valid = candidates.filter((score) => score !== null);
  return valid.length ? Math.min(...valid) : null;
}

function scoreValue(candidate, token, base) {
  if (candidate === token) return base;
  if (candidate.startsWith(token)) return base + 10;
  if (candidate.split(" ").some((word) => word.startsWith(token))) return base + 20;
  if (candidate.includes(token)) return base + 30;
  return null;
}
