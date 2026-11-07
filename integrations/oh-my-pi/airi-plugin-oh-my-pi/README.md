# @proj-airi/airi-plugin-oh-my-pi

oh-my-pi (omp) coding-agent extension bridging omp sessions to AIRI's Channel Server.

## Load methods

1. `extensions:` entry in `~/.omp/agent/config.yml` pointing at `/home/vi/Code/airi/integrations/oh-my-pi/airi-plugin-oh-my-pi` (directory entry resolves via the `omp.extensions` manifest).
2. `omp --extension /home/vi/Code/airi/integrations/oh-my-pi/airi-plugin-oh-my-pi`
3. Copy the package directory into `~/.omp/agent/extensions/`.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `AIRI_WS_URL` | `ws://localhost:6121/ws` | AIRI channel server WebSocket URL (host-only URLs get `/ws` appended automatically) |
| `AIRI_TOKEN` | (none) | Optional auth token |

## Behavior

- User prompts are forwarded as `input:text` with `textRaw` set and `overrides.messagePrefix` = `[oh-my-pi · <cwd-basename> · <model>] `.
- Turn completions are forwarded as `spark:notify` pings addressed by exact peer name to the AIRI stage peers (`proj-airi:stage-web` / `proj-airi:stage-tamagotchi`), where the character orchestrator listens; prefixed destination forms truncate at the second colon in the server route matcher, so plain peer names are used.
- AIRI replies are injected as `airi-reply` agent-attributed messages, correlated by `textRaw`.

AIRI desktop (stage-tamagotchi) must be running.
