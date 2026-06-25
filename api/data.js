// ═══════════════════════════════════════════════════════
//  Primary:  football-data.org  (standings, fixtures, scorers)
//  Stats:    api-football        (match stats, player stats)
// ═══════════════════════════════════════════════════════

const FD_KEY  = process.env.FOOTBALL_DATA_API_KEY;
const AF_KEY  = process.env.API_FOOTBALL_KEY;
const FD_BASE = 'https://api.football-data.org/v4';
const AF_BASE = 'https://v3.football.api-sports.io';
const WC_AF   = { league: 1, season: 2026 };

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
  const d = await r.json();
  if (d.errors && Object.keys(d.errors).length) throw new Error(JSON.stringify(d.errors));
  return d;
}

// ── name normalisation for fuzzy team matching ───────────
const NAME_MAP = {
  'korea republic':    'south korea',
  'ir iran':           'iran',
  'côte d\'ivoire':    'ivory coast',
  "cote d'ivoire":     'ivory coast',
  'congo dr':          'dr congo',
  'cape verde':        'cape verde islands',
  'czechia':           'czech republic',
  'türkiye':           'turkey',
};
function norm(s = '') {
  let n = s.toLowerCase().replace(/\s+/g, ' ').trim();
  return NAME_MAP[n] || n;
}

// ── scorer name fuzzy match (handles L. Messi ↔ Lionel Messi) ──
function nameMatch(apiName = '', listName = '') {
  const a = apiName.toLowerCase();
  const b = listName.toLowerCase();
  if (a === b) return true;
  // "L. Messi" → last name "messi" matches "lionel messi"
  const parts = b.split(' ');
  const last = parts[parts.length - 1];
  const first = parts[0];
  if (last.length > 2 && a.includes(last)) return true;
  // first initial match: "k. mbappé" ↔ "kylian mbappé"
  const initials = a.match(/^([a-z])\.\s/);
  if (initials && b.startsWith(initials[1]) && a.includes(last)) return true;
  return false;
}

// ── all-time data ─────────────────────────────────────────
// PRE-2026 goals for active players (historical baseline, never changes)
const PRE2026 = {
  'Lionel Messi':      13,
  'Kylian Mbappé':    12,
  'Cristiano Ronaldo': 8,
  'Neymar Jr':         6,
};

const ALLTIME = [
  { player:'Miroslav Klose',    country:'Germany',   flag:'🇩🇪', pre:16, years:'2002–2014', wiki:'Miroslav_Klose',               active:false },
  { player:'Ronaldo Nazário',   country:'Brazil',    flag:'🇧🇷', pre:15, years:'1994–2006', wiki:'Ronaldo_(Brazilian_footballer)', active:false },
  { player:'Gerd Müller',       country:'Germany',   flag:'🇩🇪', pre:14, years:'1970–1974', wiki:'Gerd_Müller',                   active:false },
  { player:'Just Fontaine',     country:'France',    flag:'🇫🇷', pre:13, years:'1958',      wiki:'Just_Fontaine',                 active:false },
  { player:'Lionel Messi',      country:'Argentina', flag:'🇦🇷', pre:13, years:'2006–',     wiki:'Lionel_Messi',                  active:true  },
  { player:'Pelé',              country:'Brazil',    flag:'🇧🇷', pre:12, years:'1958–1970', wiki:'Pelé',                          active:false },
  { player:'Kylian Mbappé',    country:'France',    flag:'🇫🇷', pre:12, years:'2018–',     wiki:'Kylian_Mbappé',                active:true  },
  { player:'Sándor Kocsis',     country:'Hungary',   flag:'🇭🇺', pre:11, years:'1954',      wiki:'Sándor_Kocsis',                 active:false },
  { player:'Jürgen Klinsmann',  country:'Germany',   flag:'🇩🇪', pre:11, years:'1990–1998', wiki:'Jürgen_Klinsmann',              active:false },
  { player:'Thomas Müller',     country:'Germany',   flag:'🇩🇪', pre:10, years:'2010–2018', wiki:'Thomas_Müller',                 active:false },
  { player:'Teófilo Cubillas',  country:'Peru',      flag:'🇵🇪', pre:10, years:'1970–1978', wiki:'Teófilo_Cubillas',              active:false },
  { player:'Grzegorz Lato',     country:'Poland',    flag:'🇵🇱', pre:10, years:'1974–1982', wiki:'Grzegorz_Lato',                 active:false },
  { player:'Gary Lineker',      country:'England',   flag:'🏴󠁧󠁢󠁥󠁮󠁧󠁿', pre:10, years:'1986–1990', wiki:'Gary_Lineker',                 active:false },
  { player:'Gabriel Batistuta', country:'Argentina', flag:'🇦🇷', pre:10, years:'1994–2002', wiki:'Gabriel_Batistuta',             active:false },
  { player:'Cristiano Ronaldo', country:'Portugal',  flag:'🇵🇹', pre:8,  years:'2006–',     wiki:'Cristiano_Ronaldo',             active:true  },
];

// ══ MAIN HANDLER ════════════════════════════════════════
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { type, matchId, teamId, date, home, away } = req.query;

  try {

    // ── 1. MATCH DETAIL (football-data.org)
    if (type === 'match' && matchId) {
      const data = await fd(`/matches/${matchId}`);
      res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
      return res.status(200).json(data);
    }

    // ── 2. MATCH STATS — FAST PATH with extended date search
    if (type === 'matchstats') {
      if (!date || !home || !away) {
        return res.status(400).json({ error: 'date, home, away required' });
      }

      // Try 3 dates: given, day before, day after (handles UTC vs CAT drift both ways)
      const baseDate = new Date(date + 'T12:00:00Z');
      const prevDate = new Date(baseDate); prevDate.setUTCDate(baseDate.getUTCDate() - 1);
      const nextDate = new Date(baseDate); nextDate.setUTCDate(baseDate.getUTCDate() + 1);
      const datesToTry = [
        date,
        prevDate.toISOString().slice(0, 10),
        nextDate.toISOString().slice(0, 10),
      ];

      const normHome = norm(home);
      const normAway = norm(away);
      // Extract first meaningful word (skip short words)
      const hw = normHome.split(' ').find(w => w.length > 2) || normHome.split(' ')[0];
      const aw = normAway.split(' ').find(w => w.length > 2) || normAway.split(' ')[0];

      let match = null;
      let allFixtures = [];

      for (const tryDate of datesToTry) {
        try {
          const dayData = await af(
            `/fixtures?league=${WC_AF.league}&season=${WC_AF.season}&date=${tryDate}`
          );
          const fixtures = dayData.response || [];
          allFixtures = [...allFixtures, ...fixtures];

          match = fixtures.find(f => {
            const fh = norm(f.teams.home.name);
            const fa = norm(f.teams.away.name);
            // 1. Exact normalised match
            if ((fh === normHome && fa === normAway) || (fh === normAway && fa === normHome)) return true;
            // 2. Both teams partially matched
            if ((fh.includes(hw) && fa.includes(aw)) || (fh.includes(aw) && fa.includes(hw))) return true;
            // 3. One team matches exactly, other matches first word
            if (fh === normHome && fa.includes(aw)) return true;
            if (fa === normAway && fh.includes(hw)) return true;
            if (fh === normAway && fa.includes(hw)) return true;
            if (fa === normHome && fh.includes(aw)) return true;
            return false;
          });
          if (match) break;
        } catch(e) { /* try next date */ }
      }

      if (!match) {
        // Return debug info so we can see what API-Football has
        return res.status(200).json({
          found: false,
          message: `No match: ${home} vs ${away}`,
          tried: datesToTry,
          available: allFixtures.map(f => ({
            date: f.fixture.date?.slice(0,10),
            home: f.teams.home.name,
            away: f.teams.away.name,
            status: f.fixture.status.short,
          })),
        });
      }

      const afId = match.fixture.id;
      const isLive = ['1H','HT','2H','ET','BT','P'].includes(match.fixture.status.short);
      const isFinished = match.fixture.status.short === 'FT';

      // Fetch stats + players in parallel
      const [statsRes, playersRes] = await Promise.allSettled([
        af(`/fixtures/statistics?fixture=${afId}`),
        af(`/fixtures/players?fixture=${afId}`),
      ]);

      const stats   = statsRes.status   === 'fulfilled' ? statsRes.value.response   : [];
      const players = playersRes.status === 'fulfilled' ? playersRes.value.response : [];

      res.setHeader('Cache-Control', isLive
        ? 's-maxage=60, stale-while-revalidate=90'
        : 's-maxage=7200, stale-while-revalidate=14400');

      return res.status(200).json({ found: true, afId, stats, players, fixture: match });
    }

    // ── 3. PLAYER STATS for a team
    if (type === 'playerstats' && teamId) {
      const data = await af(`/players?league=${WC_AF.league}&season=${WC_AF.season}&team=${teamId}`);
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
      return res.status(200).json(data);
    }

    // ── 4. SQUAD (football-data.org)
    if (type === 'squad' && teamId) {
      const [squadData, afTeamsData] = await Promise.allSettled([
        fd(`/teams/${teamId}`),
        af(`/teams?league=${WC_AF.league}&season=${WC_AF.season}`),
      ]);
      const squad = squadData.status === 'fulfilled' ? squadData.value : {};
      const afTeams = afTeamsData.status === 'fulfilled' ? afTeamsData.value.response : [];
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
      return res.status(200).json({ ...squad, afTeams });
    }

    // ── TEAM JOURNEY — all matches + stats for one team
    if (type === 'teamjourney' && teamId) {
      const id = parseInt(teamId);
      // Fetch team matches from football-data.org
      const [matchesRes, squadRes] = await Promise.allSettled([
        fd(`/competitions/WC/matches?limit=200`),
        fd(`/teams/${id}`),
      ]);
      const allMatches = matchesRes.status === 'fulfilled' ? matchesRes.value.matches : [];
      const squadData  = squadRes.status  === 'fulfilled' ? squadRes.value : {};

      // Filter matches involving this team
      const teamMatches = allMatches.filter(m =>
        m.homeTeam?.id === id || m.awayTeam?.id === id
      ).sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

      // Build stats
      let goalsFor = 0, goalsAgainst = 0, wins = 0, draws = 0, losses = 0;
      const form = [];
      teamMatches.forEach(m => {
        if (m.status !== 'FINISHED') return;
        const isHome = m.homeTeam?.id === id;
        const gf = isHome ? (m.score?.fullTime?.home ?? 0) : (m.score?.fullTime?.away ?? 0);
        const ga = isHome ? (m.score?.fullTime?.away ?? 0) : (m.score?.fullTime?.home ?? 0);
        goalsFor += gf; goalsAgainst += ga;
        if (gf > ga) { wins++; form.push('W'); }
        else if (gf === ga) { draws++; form.push('D'); }
        else { losses++; form.push('L'); }
      });

      res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=300');
      return res.status(200).json({
        team: squadData,
        matches: teamMatches,
        stats: { goalsFor, goalsAgainst, wins, draws, losses, played: wins+draws+losses, form },
      });
    }


    if (type === 'scorers') {
      const data = await fd(`/competitions/WC/scorers?limit=100`);
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
      return res.status(200).json(data);
    }

    // ── 6. ALL-TIME — merge static baseline + live 2026 goals
    if (type === 'alltime') {
      // Fetch live scorers to get 2026 goals for active players
      let wc2026Goals = {}; // player name → goals scored IN 2026 so far
      try {
        const sc = await fd(`/competitions/WC/scorers?limit=100`);
        (sc.scorers || []).forEach(s => {
          const apiName = s.player?.name || '';
          const goals   = s.goals || 0;
          if (!goals) return;
          // Try to match against every active player using fuzzy match
          for (const p of ALLTIME) {
            if (!p.active) continue;
            if (nameMatch(apiName, p.player)) {
              wc2026Goals[p.player] = (wc2026Goals[p.player] || 0) + goals;
              break;
            }
          }
        });
      } catch(e) {
        console.error('scorers fetch failed:', e.message);
      }

      // Build merged list: total = pre-2026 baseline + goals scored in 2026
      const merged = ALLTIME.map(p => {
        const added = p.active ? (wc2026Goals[p.player] || 0) : 0;
        return {
          ...p,
          goals:  p.pre + added,   // TOTAL all-time including 2026
          wc2026: added,            // how many scored in 2026 specifically
        };
      })
      .sort((a, b) => b.goals - a.goals || a.player.localeCompare(b.player))
      .map((p, i) => ({ ...p, rank: i + 1 }));

      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
      return res.status(200).json({ scorers: merged });
    }

    // ── 7. DEFAULT — standings + matches + teams
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
    console.error('[data.js]', err.message);
    res.status(500).json({ error: err.message });
  }
}
