const PRESETS = {
  preparation: [
    ["prepare", "Подготовить", "Prepare", "#D49942", "triangle"],
    ["ready", "Готово", "Ready", "#62A879", "circle"],
    ["verified", "Проверено", "Verified", "#658FC4", "star"]
  ],
  story: [
    ["quest", "Квест", "Quest", "#BE944A", "star"],
    ["clue", "Зацепка", "Clue", "#5AADB0", "diamond"],
    ["secret", "Секрет", "Secret", "#9B7ABA", "square"]
  ],
  relations: [
    ["ally", "Союзник", "Ally", "#62A879", "circle"],
    ["enemy", "Противник", "Enemy", "#C56666", "triangle"],
    ["neutral", "Нейтральный", "Neutral", "#8593A6", "square"]
  ]
};

export function getPresetTags(id, language = globalThis.game?.i18n?.lang) {
  if (!Object.hasOwn(PRESETS, id)) throw new Error("Unknown FTags preset");
  return PRESETS[id].map(([key, ru, en, color, shape]) => ({
    id: `preset-${id}-${key}`, name: language?.startsWith("ru") ? ru : en, color, shape,
    aliases: [ru, en]
  }));
}
