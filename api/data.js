const API_KEY = process.env.FOOTBALL_DATA_API_KEY;
const BASE = 'https://api.football-data.org/v4';
const COMP = 'WC';

const headers = {
  'X-Auth-Token': API_KEY,
  'Content-Type': 'application/json',
};

async function fetchFD(path) {
  const res = await fetch(`${BASE}${path}`, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`football-data.org ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

export default async function handler(req, res) {
  // CORS for public access
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { type, matchId } = req.query;

  try {
    // ── Single match detail (for modal)
    if (type === 'match' && matchId) {
      const data = await fetchFD(`/matches/${matchId}`);
      res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
      return res.status(200).json(data);
    }

    // ── Scorers
    if (type === 'scorers') {
      const data = await fetchFD(`/competitions/${COMP}/scorers?limit=50`);
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
      return res.status(200).json(data);
    }

    // ── All-time WC scorers (historical — separate season filter not needed;
    //    football-data.org returns the active season's scorers automatically)
    if (type === 'alltime') {
      // All-time WC top scorers are a static well-known list.
      // football-data.org doesn't provide historical WC scorer records,
      // so we return a curated static list here.
      const alltime = [
        { rank:1, player:'Miroslav Klose', country:'Germany', flag:'🇩🇪', goals:16, tournaments:'2002,2006,2010,2014', img:'Miroslav_Klose' },
        { rank:2, player:'Ronaldo Nazário', country:'Brazil', flag:'🇧🇷', goals:15, tournaments:'1994,1998,2002,2006', img:'Ronaldo_Nazário' },
        { rank:3, player:'Gerd Müller', country:'Germany', flag:'🇩🇪', goals:14, tournaments:'1970,1974', img:'Gerd_Müller' },
        { rank:4, player:'Just Fontaine', country:'France', flag:'🇫🇷', goals:13, tournaments:'1958', img:'Just_Fontaine' },
        { rank:5, player:'Pelé', country:'Brazil', flag:'🇧🇷', goals:12, tournaments:'1958,1962,1966,1970', img:'Pelé' },
        { rank:6, player:'Jürgen Klinsmann', country:'Germany', flag:'🇩🇪', goals:11, tournaments:'1990,1994,1998', img:'Jürgen_Klinsmann' },
        { rank:6, player:'Sándor Kocsis', country:'Hungary', flag:'🇭🇺', goals:11, tournaments:'1954', img:'Sándor_Kocsis' },
        { rank:8, player:'Teófilo Cubillas', country:'Peru', flag:'🇵🇪', goals:10, tournaments:'1970,1978', img:'Teófilo_Cubillas' },
        { rank:8, player:'Grzegorz Lato', country:'Poland', flag:'🇵🇱', goals:10, tournaments:'1974,1978,1982', img:'Grzegorz_Lato' },
        { rank:8, player:'Gary Lineker', country:'England', flag:'🏴󠁧󠁢󠁥󠁮󠁧󠁿', goals:10, tournaments:'1986,1990', img:'Gary_Lineker' },
        { rank:8, player:'Lionel Messi', country:'Argentina', flag:'🇦🇷', goals:13, tournaments:'2006,2010,2014,2018,2022', img:'Lionel_Messi' },
        { rank:8, player:'Cristiano Ronaldo', country:'Portugal', flag:'🇵🇹', goals:8, tournaments:'2006,2010,2014,2018,2022', img:'Cristiano_Ronaldo' },
      ].sort((a,b) => b.goals - a.goals);
      return res.status(200).json({ scorers: alltime });
    }

    // ── Default: full dashboard data (standings + matches)
    const [standingsData, matchesData] = await Promise.all([
      fetchFD(`/competitions/${COMP}/standings`),
      fetchFD(`/competitions/${COMP}/matches?limit=200`),
    ]);

    res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=300');
    return res.status(200).json({
      standings: standingsData.standings,
      season: standingsData.season,
      matches: matchesData.matches,
      lastUpdated: new Date().toISOString(),
    });

  } catch (err) {
    console.error('API error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
