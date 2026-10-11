export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).end();
  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) return res.status(401).end();
  const url = process.env.VITE_SUPABASE_URL;
  const apikey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !apikey) return res.status(503).end();
  try {
    const auth = await fetch(`${url}/auth/v1/user`, { headers: { authorization, apikey }, signal: AbortSignal.timeout(5000) });
    if (!auth.ok) return res.status(401).end();
    const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) iceServers.push({ urls: process.env.TURN_URL, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
    return res.status(200).json({ iceServers });
  } catch { return res.status(503).end(); }
}
