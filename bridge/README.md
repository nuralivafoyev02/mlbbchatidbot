# MLBB Bengkel Bridge

HTTP bridge for checking MLBB account bindings through `@bengkelmlbb_bot`.

The main bot cannot talk to another Telegram bot through Bot API, so this bridge uses a real Telegram user session through GramJS.

## Environment

```env
PORT=8788
TELEGRAM_API_ID=123456
TELEGRAM_API_HASH=your_api_hash
TELEGRAM_SESSION=your_string_session
BRIDGE_SECRET=change-this-secret
BENGKEL_BOT_USERNAME=bengkelmlbb_bot
BENGKEL_RESPONSE_TIMEOUT_MS=90000
```

Get `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` from `https://my.telegram.org/apps`.

Generate `TELEGRAM_SESSION` locally:

```bash
cd bridge
npm install
TELEGRAM_API_ID=123456 TELEGRAM_API_HASH=your_api_hash npm run session
```

Store the printed `TELEGRAM_SESSION` as a hosting secret. Do not commit it.

For local use, put secrets in `bridge/.env` using the same keys. The scripts load
that file automatically.

## Run

```bash
cd bridge
npm install
npm start
```

## Docker

```bash
cd bridge
docker build -t mlbb-bengkel-bridge .
docker run --env-file .env -p 8788:8788 mlbb-bengkel-bridge
```

## macOS LaunchAgent

The `launchd/` folder contains local background service definitions for:

- `com.mlbb.bengkel.bridge`
- `com.mlbb.bengkel.tunnel`

They run the bridge on `127.0.0.1:8788` and expose it through a Cloudflare
Quick Tunnel. Quick Tunnel URLs can change when the tunnel restarts.

Health check:

```bash
curl http://localhost:8788/health
```

Lookup:

```bash
curl -X POST http://localhost:8788/bengkel \
  -H "Content-Type: application/json" \
  -d '{"account_id":"1006613098","zone_id":"13019","bot_username":"bengkelmlbb_bot","message":"/info 1006613098 13019","x_key":"change-this-secret"}'
```

## Main Bot Config

After deploying this bridge to a public HTTPS host, configure the main Worker:

```env
MLBB_BIND_INFO_PROVIDER=bengkel
MLBB_BIND_INFO_API_URL=https://your-bridge-host.example.com/bengkel
MLBB_BIND_INFO_API_METHOD=POST
MLBB_BIND_INFO_BENGKEL_BOT_USERNAME=bengkelmlbb_bot
MLBB_BIND_INFO_BENGKEL_MESSAGE_TEMPLATE=/info {account_id} {zone_id}
MLBB_BIND_INFO_API_KEY=change-this-secret
```

Use the same value for `MLBB_BIND_INFO_API_KEY` and bridge `BRIDGE_SECRET`.
