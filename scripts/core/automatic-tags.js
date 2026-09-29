// System-derived facets live only in the search index, never in document flags.
const CREATURES = {
  aberration: "Аберрация", beast: "Зверь", celestial: "Небожитель", construct: "Конструкт",
  dragon: "Дракон", elemental: "Элементаль", fey: "Фея", fiend: "Исчадие", giant: "Великан",
  humanoid: "Гуманоид", monstrosity: "Монстр", ooze: "Слизь", plant: "Растение", undead: "Нежить"
};
const ITEMS = {
  weapon: "Оружие", equipment: "Снаряжение", consumable: "Расходник", tool: "Инструмент",
  loot: "Добыча", container: "Контейнер", spell: "Заклинание", feat: "Особенность",
  class: "Класс", subclass: "Подкласс", background: "Предыстория", race: "Вид"
};
const RARITIES = {
  common: ["Обычное", "обычный", "обычная", "обычной"],
  uncommon: ["Необычное", "необычный", "необычная", "необычной"],
  rare: ["Редкое", "редкий", "редкая", "редкой"],
  veryRare: ["Очень редкое", "очень редкий", "очень редкая", "очень редкой", "very rare"],
  legendary: ["Легендарное", "легендарный", "легендарная", "легендарной"],
  artifact: ["Артефакт", "артефактной"]
};
const RANGES = {
  melee: ["Ближнее", "ближний", "ближнего боя", "рукопашное"],
  ranged: ["Дальнобойное", "дальнобойный", "дальнего боя", "дальнее", "дистанционное"]
};
export const CR_VALUES = [0, 0.125, 0.25, 0.5, ...Array.from({length: 30}, (_, i) => i + 1)];
let cachedLanguage;
let cachedLibrary;

export function parseCR(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const text = String(value).trim();
  if (!/^\d+(?:[.,]\d+)?(?:\/\d+)?$/.test(text)) return null;
  const [numerator, denominator = "1"] = text.replace(",", ".").split("/");
  const number = Number(numerator) / Number(denominator);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function makeTag(facet, value, ru, aliases, language) {
  const english = facet === "cr" ? `CR ${ru}` : String(value).replace("veryRare", "very rare");
  return {
    id: `auto-dnd5e-${facet}-${String(value).replace(".", "_")}`,
    name: language?.startsWith("ru") ? (facet === "cr" ? `CR ${ru}` : ru) : english,
    color: "#8593A6", shape: "circle", automatic: true, facet, value,
    aliases: [...new Set([english, ru, ...aliases].map(String))]
  };
}

export function getAutomaticTagLibrary({systemId = globalThis.game?.system?.id, language = globalThis.game?.i18n?.lang} = {}) {
  if (systemId !== "dnd5e") return [];
  if (cachedLibrary && cachedLanguage === language) return cachedLibrary;
  cachedLanguage = language;
  cachedLibrary = [
    ...Object.entries(CREATURES).map(([key, ru]) => makeTag("creature", key, ru, [], language)),
    ...Object.entries(ITEMS).map(([key, ru]) => makeTag("item", key, ru, key === "equipment" ? ["экипировка"] : [], language)),
    ...Object.entries(RARITIES).map(([key, [ru, ...aliases]]) => makeTag("rarity", key, ru, [key, ...aliases], language)),
    ...Object.entries(RANGES).map(([key, [ru, ...aliases]]) => makeTag("range", key, ru, aliases, language)),
    ...CR_VALUES.map(value => {
      const label = ({0.125: "1/8", 0.25: "1/4", 0.5: "1/2"})[value] ?? String(value);
      return makeTag("cr", value, label, [`CR ${value}`, `ПО ${label}`], language);
    })
  ];
  return cachedLibrary;
}

export function getAutomaticTags(document, {documentName = document?.documentName, ...options} = {}) {
  const library = getAutomaticTagLibrary(options);
  if (!library.length || !document?.system) return [];
  const system = document.system;
  const facets = {};
  if (documentName === "Actor") {
    const type = system.details?.type;
    facets.creature = typeof type === "string" ? type : type?.value;
    if (document.type === "npc") facets.cr = parseCR(system.details?.cr);
  } else if (documentName === "Item") {
    facets.item = document.type;
    facets.rarity = system.rarity;
    if (document.type === "weapon") {
      const type = system.type?.value ?? system.weaponType;
      // Throwing a melee weapon does not turn it into a ranged weapon category.
      facets.range = ({simpleM: "melee", martialM: "melee", simpleR: "ranged", martialR: "ranged", siege: "ranged"})[type];
    }
  }
  return library.filter(tag => facets[tag.facet] === tag.value);
}

export function getAutomaticIndexFields(documentName, systemId = globalThis.game?.system?.id) {
  if (systemId !== "dnd5e") return [];
  if (documentName === "Actor") return ["type", "system.details.cr", "system.details.type"];
  if (documentName === "Item") return ["type", "system.rarity", "system.type.value", "system.weaponType"];
  return [];
}
