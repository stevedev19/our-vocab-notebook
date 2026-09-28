# Our Vocab Notebook · 우리 단어장

A shared, live-synced Korean ⇄ English vocabulary notebook for two people.
No dependencies — just Node 18+.

## Access key (Vercel)

The notebook is locked by a secret key that goes in the link: `https://<your-app>.vercel.app/#k=<key>`.
Pick a key yourself: add an `ACCESS_KEY` environment variable in Vercel
(Project → Settings → Environment Variables), redeploy, then open
`https://<your-app>.vercel.app/#k=<that key>` and share that whole link.
Without `ACCESS_KEY`, a random key is generated and stored in MongoDB
(`vocabapp.store`, document `vocab:db`, field `data.key`).

If you see "This notebook is private", paste the link or key into the box on that screen.

## Run locally (legacy)

```sh
npm start              # or: node server.js   (PORT=3000 by default)
```

The server prints links like `http://192.168.x.x:3000/#k=…`. The `#k=…` part
is the notebook's secret key — share the **whole** link.

## Share publicly (no account needed)

```sh
brew install cloudflared
cloudflared tunnel --url http://127.0.0.1:3000
```

Open the printed `https://….trycloudflare.com` address with `/#k=<key>` added
(the key is in `data/db.json`). The address changes every time the tunnel
restarts, and only works while this computer is on and awake.

## Data

Everything lives in `data/db.json` (words, study history, activity, access key).
Back it up by copying the file. Deleting the `key` field and restarting
generates a new key, which locks out old links.
