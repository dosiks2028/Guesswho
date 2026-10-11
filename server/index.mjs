import http from 'node:http';
import {randomUUID} from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { createDatabase } from './database.mjs';
import { createDatabaseViewer } from './db-viewer.mjs';
import { networkInterfaces } from 'node:os';

try { process.loadEnvFile('.env'); } catch {}
const port = Number(process.env.PORT || 3000);
const root = resolve('dist');
const database = await createDatabase(resolve(process.env.DATA_DIR || 'server/.data'));
const viewer = createDatabaseViewer(database.db);
if(process.env.DB_VIEWER_PORT!=='0') {
  const viewerPort=Number(process.env.DB_VIEWER_PORT || 3002);
  viewer.on('error',error=>console.error('Database viewer:',error.message));
  viewer.listen(viewerPort,'127.0.0.1',()=>console.log(`Database viewer: http://127.0.0.1:${viewerPort}`));
}
const limits = new Map();
function allowed(key, count, interval) {
  const now = Date.now(); const item = limits.get(key);
  if (!item || item.until < now) { limits.set(key,{count:1,until:now+interval}); return true; }
  item.count++; return item.count <= count;
}
const sweep = setInterval(() => { for (const [key,value] of limits) if (value.until < Date.now()) limits.delete(key); },60000);
function json(res, status, value) { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(value)); }
const server = http.createServer(async (req,res) => {
  res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy','camera=(), microphone=(self)');
  const url = new URL(req.url,'http://localhost');
  const token = (req.headers.authorization || '').replace(/^Bearer /,'');
  const ip = req.socket.remoteAddress;
  try {
    if (url.pathname === '/api/health') return json(res,200,{status:'ok',database:'postgresql-pglite',mode:'local'});
    if (url.pathname === '/api/ice') {
      if (!await database.authenticate(token)) return json(res,401,{error:'UNAUTHORIZED'});
      const iceServers = [{urls:'stun:stun.l.google.com:19302'}];
      if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) iceServers.push({urls:process.env.TURN_URL,username:process.env.TURN_USERNAME,credential:process.env.TURN_CREDENTIAL});
      return json(res,200,{iceServers});
    }
    if (url.pathname.startsWith('/api/local/')) {
      if (req.method !== 'POST') return json(res,405,{error:'METHOD_NOT_ALLOWED'});
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host && !['localhost:5173','127.0.0.1:5173'].includes(new URL(req.headers.origin).host)) return json(res,403,{error:'ORIGIN_NOT_ALLOWED'});
      if (!allowed(`ip:${ip}`,240,60000)) return json(res,429,{error:'RATE_LIMIT'});
      const chunks=[]; let bytes=0; for await (const chunk of req) { bytes+=chunk.length; if (bytes>6500000) return json(res,413,{error:'BODY_TOO_LARGE'}); chunks.push(chunk); }
      const body=Buffer.concat(chunks).toString('utf8');
      let input; try { input = JSON.parse(body); } catch { return json(res,400,{error:'INVALID_JSON'}); }
      if (url.pathname === '/api/local/session') {
        if (!await database.authenticate(token) && !allowed(`session:${ip}`,20,3600000)) return json(res,429,{error:'RATE_LIMIT'});
        return json(res,200,await database.session(token,input.username));
      }
      if (url.pathname === '/api/local/rpc') {
        const id = await database.authenticate(token); if (!id) return json(res,401,{error:'UNAUTHORIZED'});
        const value = await database.call(id,input.fn,input.args);
        if (input.args?.p_room && !['get_game','get_room_deck','room_presence'].includes(input.fn)) broadcast(input.args.p_room,{type:'update'});
        if (input.fn === 'join_room' && value?.id) broadcast(value.id,{type:'update'});
        return json(res,200,value ?? null);
      }
      if (url.pathname === '/api/local/recovery-code') return json(res,200,{code:await database.createRecovery(await database.authenticate(token))});
      if (url.pathname === '/api/local/recover') {
        if (!allowed(`recovery:${ip}`,10,3600000)) return json(res,429,{error:'RATE_LIMIT'});
        return json(res,200,await database.recover(input.code));
      }
      return json(res,404,{error:'NOT_FOUND'});
    }
    if (url.pathname.startsWith('/api/')) return json(res,404,{error:'NOT_FOUND'});
    if (!['GET','HEAD'].includes(req.method)) return json(res,405,{error:'METHOD_NOT_ALLOWED'});
    let path = resolve(root,'.' + decodeURIComponent(url.pathname));
    if (path !== root && !path.startsWith(root + sep)) return json(res,403,{error:'FORBIDDEN'});
    if (url.pathname === '/' || !extname(path)) path = resolve(root,'index.html');
    let file; try { file = await readFile(path); } catch { return json(res,404,{error:'NOT_FOUND'}); }
    const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webp':'image/webp','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2'};
    res.setHeader('Content-Type',types[extname(path)] || 'application/octet-stream');
    res.setHeader('Cache-Control',url.pathname.startsWith('/assets/') ? 'public,max-age=31536000,immutable' : url.pathname.startsWith('/images/') ? 'public,max-age=86400' : 'no-cache');
    res.setHeader('Content-Length',file.length); res.end(req.method === 'HEAD' ? undefined : file);
  } catch (error) {
    const known = /^(UNAUTHORIZED|INVALID_[A-Z_]+|UNKNOWN_METHOD|ROOM_[A-Z_]+|NOT_YOUR_TURN|NOT_OWNED|INSUFFICIENT_COINS|RATE_LIMIT|USERNAME_TAKEN|FINAL_GUESS_REQUIRED|DECK_LIMIT|DECK_NOT_FOUND)$/;
    const message = known.test(error.message) ? error.message : 'REQUEST_FAILED';
    if (message === 'REQUEST_FAILED') console.error('Request failed:',error.message);
    json(res,message === 'UNAUTHORIZED' ? 401 : 400,{error:message});
  }
});
const wss = new WebSocketServer({noServer:true,maxPayload:16384});
server.on('upgrade',(req,socket,head) => {
  if (req.url !== '/api/local/events' || (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host && !['localhost:5173','127.0.0.1:5173'].includes(new URL(req.headers.origin).host))) return socket.destroy();
  wss.handleUpgrade(req,socket,head,ws => wss.emit('connection',ws,req));
});
function broadcast(room,payload,except) { for (const ws of wss.clients) if (ws !== except && ws.room === room && ws.readyState === WebSocket.OPEN && (payload.type !== 'signal' || ws.mode === 'voice')) ws.send(JSON.stringify(payload)); }
wss.on('connection',ws => {
  const timeout = setTimeout(() => ws.close(1008,'Authentication required'),10000);
  ws.on('message',async raw => {
    try {
      const data = JSON.parse(raw.toString());
      if (!ws.user) {
        if (ws.authenticating) return;
        ws.authenticating = true;
        if (data.type !== 'auth' || !['watch','voice'].includes(data.mode)) return ws.close(1008);
        const id = await database.authenticate(data.token); if (!id) return ws.close(1008);
        await database.call(id,'get_game',{p_room:data.room});
        if(data.mode==='voice' && !await database.call(id,'can_voice',{p_room:data.room}))return ws.close(1008,'Friends only');
        ws.user = id; ws.room = data.room; ws.mode = data.mode; ws.connection = randomUUID(); ws.alive = true; clearTimeout(timeout);
        if(ws.mode==='watch')await database.call(id,'room_presence',{p_room:ws.room,p_connection:ws.connection,p_online:true});
        ws.send(JSON.stringify({type:'ready'})); return;
      }
      if (!allowed(`ws:${ws.user}`,120,10000)) return ws.close(1008,'Rate limit');
      if (data.type === 'signal' && ws.mode === 'voice') {
        if(!await database.call(ws.user,'can_voice',{p_room:ws.room}))return ws.close(1008,'Friends only');
        broadcast(ws.room,{type:'signal',payload:{...data.payload,from:ws.user}},ws);
      }
    } catch { ws.send(JSON.stringify({type:'error'})); ws.close(1008); }
  });
  ws.on('pong',()=>{ws.alive=true;if(ws.mode==='watch')void database.call(ws.user,'room_presence',{p_room:ws.room,p_connection:ws.connection,p_online:true}).catch(()=>{});});
  ws.on('close',() => { clearTimeout(timeout); if(ws.mode==='watch')void database.call(ws.user,'room_presence',{p_room:ws.room,p_connection:ws.connection,p_online:false}).then(()=>broadcast(ws.room,{type:'update'})).catch(()=>{}); if (ws.mode === 'voice') broadcast(ws.room,{type:'signal',payload:{left:true,from:ws.user}},ws); });
});
let presenceBusy=false;
const presenceSweep=setInterval(async()=>{if(presenceBusy)return;presenceBusy=true;try{const expired=await database.db.query('select game_private.expire_rooms() as count');if(expired.rows[0].count)for(const ws of wss.clients)if(ws.mode==='watch'&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'update'}));}catch(error){console.error('Room cleanup failed:',error.message);}finally{presenceBusy=false;}},5000);
const heartbeat=setInterval(()=>{for(const ws of wss.clients){if(!ws.user)continue;if(ws.mode==='voice')void database.call(ws.user,'can_voice',{p_room:ws.room}).then(allowed=>{if(!allowed)ws.close(1008,'Friends only');}).catch(()=>ws.close(1008));if(!ws.alive){ws.terminate();continue;}ws.alive=false;ws.ping();}},15000);
server.listen(port,'0.0.0.0',() => {
  console.log(`GuessWho Arena: http://localhost:${port}`);
  for (const entries of Object.values(networkInterfaces())) for (const entry of entries || []) if (entry.family === 'IPv4' && !entry.internal) console.log(`LAN: http://${entry.address}:${port}`);
  console.log('Persistent database: ' + resolve(process.env.DATA_DIR || 'server/.data'));
});
async function stop() { clearInterval(sweep); clearInterval(heartbeat); clearInterval(presenceSweep); for (const ws of wss.clients) ws.close(); server.close(); viewer.close(); await database.close(); process.exit(0); }
process.on('SIGINT',stop); process.on('SIGTERM',stop);
