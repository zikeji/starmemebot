# starmemebot

Meme Discord bot built on discordx + discord.js v14 (same stack as starbot).

## Features

1. **Rare 67/69 reactions** — every guild message has a 1 in 1000 chance of getting reacted with 6️⃣7️⃣ or 6️⃣9️⃣. A falloff window prevents a channel from triggering twice within 5 messages.
2. **TrueSpec cable reactions** — any message mentioning "cable" has a 1 in 4 chance of getting the TrueSpec server emoji; otherwise it still goes through the 67/69 roll.
3. **Cyan reactions** — any message mentioning "cyan" has a 1 in 10 chance of getting 🩵🧑‍🦯; otherwise it still goes through the 67/69 roll.
4. **Erich pins** — any message mentioning "Erich" gets 📌, with a cooldown of at least 5 messages between pins in a channel; otherwise it still goes through the 67/69 roll.
3. **Cosmic uwu/owo replies** — any message containing `uwu` or `owo` gets a one-sentence reply from Rebecca, the project's cosmic mascot (handcuffs and all), generated via the OpenAI-compatible API using the last 20 messages as context.
6. **Proactive StarPilot 7.0 corrections** (opt-in via `CORRECTIONS_ENABLED`): when someone in an allowlisted channel mentions branches, installing or the repo, Rebecca waits for a human to answer first (60 s, extended by chatter, capped at 3 min), then posts one short correction pinging whoever still needs it, or stays silent. Sage/Contributor answers cancel it.
7. **Correct Rebecca**: an admin-only message context menu that saves a correction for review and has the LLM rewrite Rebecca's message in place.
8. **`/self-learning get`**: admin-only export of collected corrections, Rebecca's own `log_feedback` notes and correction activity as a ready-to-paste review prompt. Users in `BOT_MAINTAINER_IDS` can clear what was exported.

## Permissions

The bot needs **View Channels** + **Read Message History** at the guild level, plus **Add Reactions** and **Send Messages** in the channels it serves. Enable the **Message Content** intent in the Discord developer portal (required to detect `uwu`/`owo`).

## Setup

```bash
cp .env.example .env   # fill in DISCORD_TOKEN and OPENAI_API_KEY
npm install
npm run dev
```

Environment:

| Var | Description |
| --- | --- |
| `DISCORD_TOKEN` | Discord bot token |
| `OPENAI_ENDPOINT` | OpenAI-compatible base URL (e.g. `https://openrouter.ai/api/v1`) |
| `OPENAI_API_KEY` | API key for the endpoint |
| `OPENAI_MODEL` | Model id (e.g. `openrouter/free`) |
| `CORRECTIONS_ENABLED` | Turns on proactive corrections (off unless truthy) |
| `CORRECTION_CHANNELS` | Channel or category IDs where corrections may fire; threads inherit their parent |
| `TRUSTED_ROLE_IDS` | Roles that never trigger corrections and cancel them by answering |
| `BOT_MAINTAINER_IDS` | Users allowed to clear the self-learning collection |
| `SELF_LEARNING_FILE` | Self-learning JSONL path (default `data/self-learning.jsonl`) |

See `.env.example` for the rest.

## Scripts

- `npm run dev` — hot-reload dev server
- `npm run build` / `npm start` — compile and run
- `npm run typecheck` / `npm test`

## Docker

```bash
docker build -t starmemebot .
docker run -d --env-file .env starmemebot
```
