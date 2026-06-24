# FIFA World Cup 2026 — Live Dashboard

Self-updating dashboard deployed on Vercel. Pulls live data from football-data.org every 5 minutes.

## Project Structure

```
worldcup2026/
├── index.html          ← Full dashboard (5 tabs, auto-refresh)
├── api/
│   └── data.js         ← Vercel serverless function
├── vercel.json         ← Caching + routing
├── package.json
└── README.md
```

## Deploy Steps

### 1. Push to GitHub

```bash
cd worldcup2026
git init
git add .
git commit -m "Initial WC2026 dashboard"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/worldcup2026.git
git push -u origin main
```

### 2. Connect to Vercel

1. Go to [vercel.com](https://vercel.com) → New Project
2. Import your `worldcup2026` GitHub repo
3. Framework Preset: **Other** (leave as is)
4. Click **Deploy**

### 3. Add Environment Variable

In Vercel dashboard → Your Project → Settings → Environment Variables:

| Name | Value |
|---|---|
| `FOOTBALL_DATA_API_KEY` | `19e7d4cd636f42f99aa9a19bd86a7639` |

Set it for **Production**, **Preview**, and **Development**.

Then **redeploy** (Deployments → ... → Redeploy).

### 4. Done!

Your dashboard is live at `https://worldcup2026.vercel.app` (or your custom domain).

---

## What Updates Automatically

| Data | Refresh interval |
|---|---|
| Group standings | Every 3 min (edge cache) |
| Match scores | Every 3 min |
| Scorers (goals/assists) | Every 5 min |
| Match detail modal | Every 30 sec when open |

---

## Data Source Limits (Free Tier)

football-data.org free plan includes:
- ✅ All match scores + dates
- ✅ Group standings
- ✅ Top scorers (goals + assists)
- ✅ Basic match events (goals, who scored)
- ❌ Lineup data (requires paid plan ~€12/mo)
- ❌ Match stats: possession, shots, corners (requires paid plan)

To unlock full match stats, upgrade at https://www.football-data.org/pricing

---

## Local Development

```bash
npm install -g vercel
vercel dev
```

Then open http://localhost:3000
