const API_KEY = process.env.FOOTBALL_DATA_API_KEY;
const BASE = 'https://api.football-data.org/v4';
const COMP = 'WC';
const headers = { 'X-Auth-Token': API_KEY };

async function fd(path) {
  const r = await fetch(`${BASE}${path}`, { headers });
  if (!r.ok) throw new Error(`${path} → ${r.status}: ${await r.text()}`);
  return r.json();
}

// All-time pre-2026 goals per active player (pre-tournament baseline)
const ALLTIME_BASE = {
  'Lionel Messi':    { pre: 13, country: 'Argentina', flag: '🇦🇷', years: '2006–2022', wiki: 'Lionel_Messi' },
  'Kylian Mbappé':  { pre: 12, country: 'France',    flag: '🇫🇷', years: '2018–2022', wiki: 'Kylian_Mbappé' },
  'Cristiano Ronaldo':{ pre: 8, country: 'Portugal', flag: '🇵🇹', years: '2006–2022', wiki: 'Cristiano_Ronaldo' },
  'Neymar Jr':      { pre: 6,  country: 'Brazil',    flag: '🇧🇷', years: '2014–2022', wiki: 'Neymar' },
};

const ALLTIME_STATIC = [
  { player:'Miroslav Klose',   country:'Germany',  flag:'🇩🇪', goals:16, years:'2002–2014', wiki:'Miroslav_Klose',             active:false },
  { player:'Ronaldo Nazário',  country:'Brazil',   flag:'🇧🇷', goals:15, years:'1994–2006', wiki:'Ronaldo_(Brazilian_footballer)', active:false },
  { player:'Gerd Müller',      country:'Germany',  flag:'🇩🇪', goals:14, years:'1970–1974', wiki:'Gerd_Müller',                active:false },
  { player:'Just Fontaine',    country:'France',   flag:'🇫🇷', goals:13, years:'1958',      wiki:'Just_Fontaine',              active:false },
  { player:'Lionel Messi',     country:'Argentina',flag:'🇦🇷', goals:13, years:'2006–',     wiki:'Lionel_Messi',               active:true  },
  { player:'Pelé',             country:'Brazil',   flag:'🇧🇷', goals:12, years:'1958–1970', wiki:'Pelé',                      active:false },
  { player:'Kylian Mbappé',    country:'France',   flag:'🇫🇷', goals:12, years:'2018–',     wiki:'Kylian_Mbappé',             active:true  },
  { player:'Sándor Kocsis',    country:'Hungary',  flag:'🇭🇺', goals:11, years:'1954',      wiki:'Sándor_Kocsis',              active:false },
  { player:'Jürgen Klinsmann', country:'Germany',  flag:'🇩🇪', goals:11, years:'1990–1998', wiki:'Jürgen_Klinsmann',           active:false },
  { player:'Thomas Müller',    country:'Germany',  flag:'🇩🇪', goals:10, years:'2010–2018', wiki:'Thomas_Müller',              active:false },
  { player:'Teófilo Cubillas', country:'Peru',     flag:'🇵🇪', goals:10, years:'1970–1978', wiki:'Teófilo_Cubillas',           active:false },
  { player:'Grzegorz Lato',    country:'Poland',   flag:'🇵🇱', goals:10, years:'1974–1982', wiki:'Grzegorz_Lato',              active:false },
  { player:'Gary Lineker',     country:'England',  flag:'🏴󠁧󠁢󠁥󠁮󠁧󠁿', goals:10, years:'1986–1990', wiki:'Gary_Lineker',              active:false },
  { player:'Gabriel Batistuta',country:'Argentina',flag:'🇦🇷', goals:10, years:'1994–2002', wiki:'Gabriel_Batistuta',          active:false },
  { player:'Cristiano Ronaldo',country:'Portugal', flag:'🇵🇹', goals:8,  years:'2006–',     wiki:'Cristiano_Ronaldo',          active:true  },
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { type, matchId, teamId } = req.query;

  try {
    // Single match detail
    if (type === 'match' && matchId) {
      const data = await fd(`/matches/${matchId}`);
      res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
      return res.status(200).json(data);
    }

    // Team squad (on-demand)
    if (type === 'squad' && teamId) {
      const data = await fd(`/teams/${teamId}`);
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
      return res.status(200).json(data);
    }

    // Scorers
    if (type === 'scorers') {
      const data = await fd(`/competitions/${COMP}/scorers?limit=100`);
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
      return res.status(200).json(data);
    }

    // All-time + live 2026 totals merged
    if (type === 'alltime') {
      let liveGoals = {};
      try {
        const sc = await fd(`/competitions/${COMP}/scorers?limit=100`);
        (sc.scorers || []).forEach(s => {
          const name = s.player?.name;
          if (name && ALLTIME_BASE[name]) liveGoals[name] = s.goals || 0;
        });
      } catch(e) {}

      const merged = ALLTIME_STATIC.map(p => {
        const live = liveGoals[p.player] || 0;
        const base = ALLTIME_BASE[p.player]?.pre || p.goals;
        return { ...p, goals: p.active ? base + live : p.goals, wc2026: live };
      }).sort((a, b) => b.goals - a.goals)
        .map((p, i) => ({ ...p, rank: i + 1 }));

      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
      return res.status(200).json({ scorers: merged });
    }

    // Default: standings + matches + teams list
    const [standingsData, matchesData, teamsData] = await Promise.all([
      fd(`/competitions/${COMP}/standings`),
      fd(`/competitions/${COMP}/matches?limit=200`),
      fd(`/competitions/${COMP}/teams`),
    ]);

    res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=300');
    return res.status(200).json({
      standings: standingsData.standings,
      season: standingsData.season,
      matches: matchesData.matches,
      teams: teamsData.teams,
      lastUpdated: new Date().toISOString(),
    });

  } catch (err) {
    console.error('API error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
