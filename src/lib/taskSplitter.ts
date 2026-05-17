const cleanupTitle = (value: string) =>
  value
    .replace(/^[,.;:!?\-–—•*\d.)\s]+/, "")
    .replace(/[,.;:!?\-–—\s]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

const taskStarterFragments = [
  "сд[еэ]л[а-яё]*", "здел[а-яё]*", "добав[а-яё]*", "убер[а-яё]*", "убрат[а-яё]*", "удал[а-яё]*",
  "исправ[а-яё]*", "почин[а-яё]*", "провер[а-яё]*", "обнов[а-яё]*", "передел[а-яё]*", "настро[а-яё]*",
  "напис[а-яё]*", "ответ[а-яё]*", "отправ[а-яё]*", "позвон[а-яё]*", "созвон[а-яё]*", "встрет[а-яё]*",
  "куп[а-яё]*", "заказ[а-яё]*", "оплат[а-яё]*", "выстав[а-яё]*", "забр[а-яё]*", "отнес[а-яё]*",
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