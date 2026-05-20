const cleanupTitle = (value: string) =>
  value
    .replace(/^[,.;:!?\-–—•*\d.)\s]+/, "")
    .replace(/[,.;:!?\-–—\s]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

const taskStarterFragments = [
  "сд[еэ]л[а-яё]*", "здел[а-яё]*", "добав[а-яё]*", "убер[а-яё]*", "убрат[а-яё]*", "удал[а-яё]*",
  "исправ[а-яё]*", "поправ[а-яё]*", "почин[а-яё]*", "провер[а-яё]*", "обнов[а-яё]*", "передел[а-яё]*", "настро[а-яё]*",
  "напис[а-яё]*", "ответ(?:ить|ь|им|ите|ил|ила|или|ят)", "отправ[а-яё]*", "позвон[а-яё]*", "созвон[а-яё]*", "встрет[а-яё]*",
  "куп[а-яё]*", "закаж[а-яё]*", "заказ(?:ать|ал|ала|али|ывай[а-яё]*)", "оплат(?:ить|и|им|ите|ил|ила|или|ят)", "выстав[а-яё]*", "забр[а-яё]*", "отнес[а-яё]*",
  "подготов[а-яё]*", "законч[а-яё]*", "разобр[а-яё]*", "собра[а-яё]*", "прочит[а-яё]*", "посмотр[а-яё]*",
  "выда[а-яё]*", "покаж[а-яё]*", "сформир[а-яё]*", "раздел[а-яё]*", "сплит[а-яё]*", "отполир[а-яё]*",
  "заполн[а-яё]*", "загруз[а-яё]*", "скача[а-яё]*", "протест[а-яё]*", "депло[а-яё]*", "заплан[а-яё]*",
  "clean", "fix", "add", "remove", "delete", "write", "reply", "email", "call", "send", "create", "update", "finish",
  "prepare", "review", "check", "test", "deploy", "publish", "pay", "book", "buy", "pick", "research", "design", "record", "edit",
];

const starterSource = taskStarterFragments.join("|");
const starterRe = new RegExp(`(^|\\s)((?:${starterSource})(?=$|[\\s,.;:!?]))`, "giu");
const connectorBeforeStarterRe = new RegExp(
  `\\s+(?:и|and|&|плюс|потом|затем|также|ещ[её]|then|also|plus)\\s+(?=(?:${starterSource})(?=$|[\\s,.;:!?]))`,
  "giu",
);

function splitByRepeatedStarters(part: string): string[] {
  const starts: number[] = [];
  starterRe.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = starterRe.exec(part))) {
    const index = match.index + (match[1]?.length || 0);
    if (index > 0) starts.push(index);
  }
  starterRe.lastIndex = 0;
  if (!starts.length) return [part];
  const cutPoints = [0, ...starts, part.length];
  return cutPoints
    .slice(0, -1)
    .map((start, i) => cleanupTitle(part.slice(start, cutPoints[i + 1])))
    .filter(Boolean);
}

/**
 * Pull a duration ("5 hours", "30 min", "1h 15m", "пол часа") out of a task
 * title and return the cleaned title + minutes. Returns duration=null when
 * the title doesn't carry a duration so the caller can fall back to a
 * default. Conservative — only matches obvious patterns so we don't strip
 * real content like "30 min walk".
 */
export function extractDurationFromTitle(rawTitle: string): { title: string; duration: number | null } {
  const original = rawTitle;
  let minutes = 0;
  let matched = false;

  // Pattern: <num> h/hr/hrs/hour/hours/ч/час/часа/часов (+ optional decimals)
  const hourRe = /(\d+(?:[.,]\d+)?)\s*(?:hours?|hrs?|h|часов|часа|час|ч)\b/gi;
  // Pattern: <num> m/min/mins/minute/minutes/мин/минут
  const minuteRe = /(\d+)\s*(?:minutes?|mins?|minute|m|минут[ауы]?|мин)\b/gi;

  let m: RegExpExecArray | null;
  while ((m = hourRe.exec(original)) !== null) {
    const val = parseFloat(m[1].replace(",", "."));
    if (Number.isFinite(val) && val > 0 && val <= 24) {
      minutes += Math.round(val * 60);
      matched = true;
    }
  }
  while ((m = minuteRe.exec(original)) !== null) {
    const val = parseInt(m[1], 10);
    if (Number.isFinite(val) && val > 0 && val <= 600) {
      minutes += val;
      matched = true;
    }
  }

  // Common natural-language fragments
  const lower = original.toLowerCase();
  if (!matched) {
    if (/\bhalf an hour\b|\bhalf hour\b|пол\s*часа/.test(lower)) { minutes += 30; matched = true; }
    else if (/quarter (?:of an )?hour|четверть\s*часа/.test(lower)) { minutes += 15; matched = true; }
  }

  if (!matched || minutes <= 0) {
    return { title: cleanupTitle(original), duration: null };
  }

  // Strip the matched duration fragments from the title so the row reads cleanly.
  const cleanedTitle = cleanupTitle(
    original
      .replace(hourRe, " ")
      .replace(minuteRe, " ")
      .replace(/\bhalf an hour\b|\bhalf hour\b|пол\s*часа/gi, " ")
      .replace(/quarter (?:of an )?hour|четверть\s*часа/gi, " ")
      // Trailing connectors left behind ("for", "за", "на").
      .replace(/\s+(?:for|за|на)\s*$/i, " ")
      .replace(/\s+/g, " ")
      .trim()
  );

  // Sanity cap (24h) — protect downstream packers from absurd values.
  const capped = Math.min(minutes, 24 * 60);
  return { title: cleanedTitle || cleanupTitle(original), duration: capped };
}

export function parseBulkTasks(input: string): string[] {
  const normalized = input
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(connectorBeforeStarterRe, "\n")
    .replace(/\s+(?:[+\/|]|->|=>)\s+/g, "\n")
    .replace(/\s+[—–]\s+/g, "\n")
    .replace(/\.\s+(?=[A-ZА-ЯЁ])/g, "\n");

  const primary = normalized
    .split(/\r?\n+|[,;•]+|(?:^|\s)[-*]\s+|(?:^|\s)\d+[.)]\s+/g)
    .map(cleanupTitle)
    .filter(Boolean);

  const expanded = primary.flatMap(splitByRepeatedStarters);
  const seen = new Set<string>();
  return expanded
    .filter((title) => {
      const key = title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 40);
}