// ═══════════════════════════════════════════════════════
//  Primary source:  football-data.org  (standings, fixtures, scorers)
//  Stats source:    api-football (match stats, player stats, lineups)
// ═══════════════════════════════════════════════════════

const FD_KEY  = process.env.FOOTBALL_DATA_API_KEY;
const AF_KEY  = process.env.API_FOOTBALL_KEY;
const FD_BASE = 'https://api.football-data.org/v4';
const AF_BASE = 'https://v3.football.api-sports.io';
const WC_LEAGUE_AF = 1;     // API-Football WC league id
const WC_SEASON_AF = 2026;

// ── fetch helpers ────────────────────────────────────────
async function fd(path) {
  const r = await fetch(`${FD_BASE}${path}`, {
    headers: { 'X-Auth-Token': FD_KEY },
  });
  if (!r.ok) throw new Error(`FD ${path} → ${r.status}: ${await r.text()}`);
  return r.json();
}

async function af(path) {
  const r = await fetch(`${AF_BASE}${path}`, {
    headers: { 'x-apisports-key': AF_KEY },
  });
  if (!r.ok) throw new Error(`AF ${path} → ${r.status}: ${await r.text()}`);
  const data = await r.json();
  if (data.errors && Object.keys(data.errors).length > 0) {
    throw new Error(`AF error: ${JSON.stringify(data.errors)}`);
  }
  return data;
}

// ── in-memory fixture ID bridge ──────────────────────────
// Maps football-data fixture id → api-football fixture id
// Populated lazily when match stats are first requested
let afFixtureCache = null;   // { dateTeamKey: afFixtureId }
let afFixtureTTL   = 0;

async function getAFFixtures() {
  if (afFixtureCache && Date.now() < afFixtureTTL) return afFixtureCache;
  const data = await af(`/fixtures?league=${WC_LEAGUE_AF}&season=${WC_SEASON_AF}`);
  const map = {};
  (data.response || []).forEach(f => {
    const date  = f.fixture.date?.slice(0, 10) ?? '';          // YYYY-MM-DD
    const home  = normalise(f.teams.home.name);
    const away  = normalise(f.teams.away.name);
    map[`${date}|${home}|${away}`] = f.fixture.id;
    map[`${date}|${away}|${home}`] = f.fixture.id;             // both directions
  });
  afFixtureCache = map;
  afFixtureTTL   = Date.now() + 6 * 3600 * 1000;              // refresh every 6 h
  return map;
}

function normalise(name = '') {
  return name.toLowerCase()
    .replace(/\s+/g, ' ')
    .replace('korea republic', 'south korea')
    .replace('ir iran', 'iran')
    .replace('côte d\'ivoire', 'ivory coast')
    .replace('cote d\'ivoire', 'ivory coast')
    .replace('congo dr', 'dr congo')
    .replace('cape verde', 'cape verde islands')
    .trim();
}

// ── all-time data ────────────────────────────────────────
const ALLTIME_BASE = {
  'Lionel Messi':     { pre: 13, wiki: 'Lionel_Messi' },
  'Kylian Mbappé':   { pre: 12, wiki: 'Kylian_Mbappé' },
  'Cristiano Ronaldo':{ pre: 8,  wiki: 'Cristiano_Ronaldo' },
  'Neymar Jr':        { pre: 6,  wiki: 'Neymar' },
};

const ALLTIME_STATIC = [
  { player:'Miroslav Klose',    country:'Germany',   flag:'🇩🇪', goals:16, years:'2002–2014', wiki:'Miroslav_Klose',               active:false },
  { player:'Ronaldo Nazário',   country:'Brazil',    flag:'🇧🇷', goals:15, years:'1994–2006', wiki:'Ronaldo_(Brazilian_footballer)', active:false },
  { player:'Gerd Müller',       country:'Germany',   flag:'🇩🇪', goals:14, years:'1970–1974', wiki:'Gerd_Müller',                   active:false },
  { player:'Just Fontaine',     country:'France',    flag:'🇫🇷', goals:13, years:'1958',      wiki:'Just_Fontaine',                 active:false },
  { player:'Lionel Messi',      country:'Argentina', flag:'🇦🇷', goals:13, years:'2006–',     wiki:'Lionel_Messi',                  active:true  },
  { player:'Pelé',              country:'Brazil',    flag:'🇧🇷', goals:12, years:'1958–1970', wiki:'Pelé',                          active:false },
  { player:'Kylian Mbappé',    country:'France',    flag:'🇫🇷', goals:12, years:'2018–',     wiki:'Kylian_Mbappé',                active:true  },
  { player:'Sándor Kocsis',     country:'Hungary',   flag:'🇭🇺', goals:11, years:'1954',      wiki:'Sándor_Kocsis',                 active:false },
  { player:'Jürgen Klinsmann',  country:'Germany',   flag:'🇩🇪', goals:11, years:'1990–1998', wiki:'Jürgen_Klinsmann',              active:false },
  { player:'Thomas Müller',     country:'Germany',   flag:'🇩🇪', goals:10, years:'2010–2018', wiki:'Thomas_Müller',                 active:false },
  { player:'Teófilo Cubillas',  country:'Peru',      flag:'🇵🇪', goals:10, years:'1970–1978', wiki:'Teófilo_Cubillas',              active:false },
  { player:'Grzegorz Lato',     country:'Poland',    flag:'🇵🇱', goals:10, years:'1974–1982', wiki:'Grzegorz_Lato',                 active:false },
  { player:'Gary Lineker',      country:'England',   flag:'🏴󠁧󠁢󠁥󠁮󠁧󠁿', goals:10, years:'1986–1990', wiki:'Gary_Lineker',                 active:false },
  { player:'Gabriel Batistuta', country:'Argentina', flag:'🇦🇷', goals:10, years:'1994–2002', wiki:'Gabriel_Batistuta',             active:false },
  { player:'Cristiano Ronaldo', country:'Portugal',  flag:'🇵🇹', goals:8,  years:'2006–',     wiki:'Cristiano_Ronaldo',             active:true  },
];

// ═══════════════════════════════════════════════════════
//  MAIN HANDLER
// ═══════════════════════════════════════════════════════
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { type, matchId, teamId, date, home, away } = req.query;

  try {

    // ── 1. MATCH DETAIL (basic: from football-data.org)
    if (type === 'match' && matchId) {
      const data = await fd(`/matches/${matchId}`);
      res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
      return res.status(200).json(data);
    }

    // ── 2. MATCH STATS (rich: from api-football, bridged by date+teams)
    if (type === 'matchstats') {
      // Require date (YYYY-MM-DD), home team name, away team name
      if (!date || !home || !away) {
        return res.status(400).json({ error: 'date, home, away required' });
      }

      const map = await getAFFixtures();
      const key1 = `${date}|${normalise(home)}|${normalise(away)}`;
      const key2 = `${date}|${normalise(away)}|${normalise(home)}`;
      const afId  = map[key1] || map[key2];

      if (!afId) {
        return res.status(200).json({ found: false, message: 'Match not found in API-Football index yet' });
      }

      // Fetch stats + players in parallel — each costs 1 request
      const [statsData, playersData, eventsData] = await Promise.allSettled([
        af(`/fixtures/statistics?fixture=${afId}`),
        af(`/fixtures/players?fixture=${afId}`),
        af(`/fixtures?id=${afId}`),
      ]);

      const stats   = statsData.status   === 'fulfilled' ? statsData.value.response   : [];
      const players = playersData.status === 'fulfilled' ? playersData.value.response : [];
      const events  = eventsData.status  === 'fulfilled' ? eventsData.value.response?.[0] : null;

      // Cache finished matches for 2 h, live for 60 s
      const isLive = events?.fixture?.status?.short &&
        ['1H','HT','2H','ET','BT','P'].includes(events.fixture.status.short);
      res.setHeader('Cache-Control', isLive
        ? 's-maxage=60, stale-while-revalidate=90'
        : 's-maxage=7200, stale-while-revalidate=14400');

      return res.status(200).json({ found: true, afId, stats, players, events });
    }

    // ── 3. PLAYER STATS for a team this tournament (from api-football)
    if (type === 'playerstats' && teamId) {
      // teamId here is the API-Football team id, passed from the frontend
      const data = await af(`/players?league=${WC_LEAGUE_AF}&season=${WC_SEASON_AF}&team=${teamId}`);
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
      return res.status(200).json(data);
    }

    // ── 4. SQUAD (football-data.org — for names + positions)
    if (type === 'squad' && teamId) {
      const data = await fd(`/teams/${teamId}`);
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
      return res.status(200).json(data);
    }

    // ── 5. AF TEAM ID LOOKUP (maps fd team name → af team id)
    if (type === 'afteams') {
      const data = await af(`/teams?league=${WC_LEAGUE_AF}&season=${WC_SEASON_AF}`);
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=172800');
      return res.status(200).json(data);
    }

    // ── 6. SCORERS
    if (type === 'scorers') {
      const data = await fd(`/competitions/WC/scorers?limit=100`);
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
      return res.status(200).json(data);
    }

    // ── 7. ALL-TIME
    if (type === 'alltime') {
      let liveGoals = {};
      try {
        const sc = await fd(`/competitions/WC/scorers?limit=100`);
        (sc.scorers || []).forEach(s => {
          const n = s.player?.name;
          if (n && ALLTIME_BASE[n]) liveGoals[n] = s.goals || 0;
        });
      } catch(e) {}

      const merged = ALLTIME_STATIC.map(p => {
        const live = liveGoals[p.player] || 0;
        const base = ALLTIME_BASE[p.player]?.pre ?? p.goals;
        return { ...p, goals: p.active ? base + live : p.goals, wc2026: live };
      }).sort((a,b) => b.goals - a.goals).map((p,i) => ({ ...p, rank: i+1 }));

      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
      return res.status(200).json({ scorers: merged });
    }

    // ── 8. DEFAULT — standings + matches + teams
    const [standingsData, matchesData, teamsData] = await Promise.all([
      fd(`/competitions/WC/standings`),
      fd(`/competitions/WC/matches?limit=200`),
      fd(`/competitions/WC/teams`),
    ]);

    res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=300');
    return res.status(200).json({
      standings:   standingsData.standings,
      season:      standingsData.season,
      matches:     matchesData.matches,
      teams:       teamsData.teams,
      lastUpdated: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[data.js error]', err.message);
    res.status(500).json({ error: err.message });
  }
}
