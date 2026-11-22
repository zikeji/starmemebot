const OCTOBER = 9;
const NOVEMBER = 10;
const DECEMBER = 11;

const HALLOWEEN_CHANCE = 0.5;
const HALLOWEEN_NIGHT_CHANCE = 0.85;
const HALLOWEEN_PROMPT =
  'Seasonal flavor: it is Halloween season. Add a slight, playful flirty spooky twist to your reply (candy, costumes, haunted nebulae, a wink at whoever you are talking to) while still answering what was asked. Keep it light, one sentence, never mean.';

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

function holidayFlavor(now: Date, rng: () => number): string | undefined {
  if (now.getMonth() !== DECEMBER) return undefined;
  const day = now.getDate();
  const chance = day === 24 || day === 25 ? CHRISTMAS_CHANCE : HOLIDAY_CHANCE;
  return rng() < chance ? HOLIDAY_PROMPT : undefined;
}

export function seasonalFlavor(now: Date = new Date(), rng: () => number = Math.random): string | undefined {
  return halloweenFlavor(now, rng) ?? holidayFlavor(now, rng);
}
