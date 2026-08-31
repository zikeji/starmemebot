# starmemebot

Meme Discord bot built on discordx + discord.js v14 (same stack as starbot).

## Features

1. **Rare 67/69 reactions** — every guild message has a 1 in 1000 chance of getting reacted with 6️⃣7️⃣ or 6️⃣9️⃣. A falloff window prevents a channel from triggering twice within 5 messages.
2. **Cosmic uwu/owo replies** — any message containing `uwu` or `owo` gets a one-sentence reply from Rebecca, the project's cosmic frog mascot (handcuffs and all), generated via the OpenAI-compatible API using the last 20 messages as context.

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

## Scripts

- `npm run dev` — hot-reload dev server
- `npm run build` / `npm start` — compile and run
- `npm run typecheck` / `npm test`

## Docker

```bash
docker build -t starmemebot .
docker run -d --env-file .env starmemebot
```
