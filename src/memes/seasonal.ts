const OCTOBER = 9;
const NOVEMBER = 10;
const DECEMBER = 11;

const HALLOWEEN_CHANCE = 0.5;
const HALLOWEEN_NIGHT_CHANCE = 0.85;
const HALLOWEEN_PROMPT =
  'Seasonal flavor: it is Halloween season. Add a slight, playful flirty spooky twist to your reply (candy, costumes, haunted nebulae, a wink at whoever you are talking to) while still answering what was asked. Keep it light, one sentence, never mean.';

const THANKSGIVING_SEASON_START_DAY = 15;
const THANKSGIVING_SEASON_CHANCE = 0.5;
const THANKSGIVING_DAY_CHANCE = 0.85;
const THANKSGIVING_PROMPT =
  'Seasonal flavor: it is Thanksgiving season. Add a slight, playful flirty cozy twist to your reply (pie, a food coma, leftovers, what you are thankful for, a wink at whoever you are talking to) while still answering what was asked. Keep it light, one sentence, never mean.';

const HOLIDAY_CHANCE = 0.5;
const CHRISTMAS_CHANCE = 0.85;
const HOLIDAY_PROMPT =
  'Seasonal flavor: it is the December holiday season. Add a slight, playful flirty festive twist to your reply (mistletoe under the stars, cocoa, ugly sweaters, snow on the windshield, tracking a sleigh on radar, a wink at whoever you are talking to) while still answering what was asked. Keep it light, one sentence, never mean.';

function halloweenFlavor(now: Date, rng: () => number): string | undefined {
  const month = now.getMonth();
  const day = now.getDate();
  const inSeason = month === OCTOBER || (month === NOVEMBER && day === 1);
  if (!inSeason) return undefined;
  const chance = month === OCTOBER && day === 31 ? HALLOWEEN_NIGHT_CHANCE : HALLOWEEN_CHANCE;
  return rng() < chance ? HALLOWEEN_PROMPT : undefined;
}

const THURSDAY = 4;

function fourthThursdayOfNovember(year: number): number {
  const firstWeekday = new Date(year, NOVEMBER, 1).getDay();
  const firstThursday = 1 + ((THURSDAY - firstWeekday + 7) % 7);
  return firstThursday + 21;
}

function thanksgivingFlavor(now: Date, rng: () => number): string | undefined {
  const day = now.getDate();
  if (now.getMonth() !== NOVEMBER || day < THANKSGIVING_SEASON_START_DAY) return undefined;
  const isThanksgiving = day === fourthThursdayOfNovember(now.getFullYear());
  const chance = isThanksgiving ? THANKSGIVING_DAY_CHANCE : THANKSGIVING_SEASON_CHANCE;
  return rng() < chance ? THANKSGIVING_PROMPT : undefined;
}

function holidayFlavor(now: Date, rng: () => number): string | undefined {
  if (now.getMonth() !== DECEMBER) return undefined;
  const day = now.getDate();
  const chance = day === 24 || day === 25 ? CHRISTMAS_CHANCE : HOLIDAY_CHANCE;
  return rng() < chance ? HOLIDAY_PROMPT : undefined;
}

export function seasonalAccent(now: Date = new Date(), rng: () => number = Math.random): string | undefined {
  const emoji = new Map([[HALLOWEEN_PROMPT, '🎃'], [THANKSGIVING_PROMPT, '🥧'], [HOLIDAY_PROMPT, '🎄']]).get(seasonalFlavor(now, rng) ?? '');
  return emoji && `Seasonal accent: you may use one ${emoji} emoji. No words about the season.`;
}

export function seasonalFlavor(now: Date = new Date(), rng: () => number = Math.random): string | undefined {
  return halloweenFlavor(now, rng) ?? thanksgivingFlavor(now, rng) ?? holidayFlavor(now, rng);
}
