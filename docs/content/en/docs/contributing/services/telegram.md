---
title: Telegram Bot
description: Contribute to Project Anima
---

### Telegram bot integration

A Postgres database is required.

```shell
cd services/telegram-bot
docker compose up -d
```

Configure `.env`

```shell
cp .env .env.local
```

Edit the credentials in `.env.local`.

Migrate the database

```shell
pnpm -F @proj-anima/telegram-bot db:generate
pnpm -F @proj-anima/telegram-bot db:push
```

Run the bot

```shell
pnpm -F @proj-anima/telegram-bot start
```

::: tip

For [@antfu/ni](https://github.com/antfu-collective/ni) users, you can

```shell
nr -F @proj-anima/telegram-bot dev
```

:::
