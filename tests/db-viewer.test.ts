import http from 'node:http';
import {beforeAll,afterAll,test,expect} from 'vitest';
import {createDatabase} from '../server/database.mjs';
import {createDatabaseViewer} from '../server/db-viewer.mjs';
let backend:Awaited<ReturnType<typeof createDatabase>>,server:ReturnType<typeof createDatabaseViewer>,base:string;
beforeAll(async()=>{
  backend=await createDatabase('memory://');
  const a=await backend.session('','Viewer Rich'),b=await backend.session('','Viewer Other');
  await backend.db.query('update public.profiles set coins=1000000 where id=$1',[a.profile.id]);
  await backend.call(a.profile.id,'create_room',{p_category:'naruto',p_public:false});
  await backend.call(a.profile.id,'request_friend',{p_code:b.profile.friend_code});
  const ticket=await backend.call(b.profile.id,'start_practice_streak',{p_category:'naruto'});
  await backend.call(b.profile.id,'finish_practice_streak',{p_ticket:ticket,p_outcome:'win'});
  server=createDatabaseViewer(backend.db);
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
},30000);
afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await backend.close();});
test('viewer lists balances, supports search and reads every allowed table',async()=>{
  const summary=await(await fetch(base+'/api/overview')).json();expect(summary.users).toBe(2);expect(Number(summary.coins)).toBe(1000025);
  const players=await(await fetch(base+'/api/rows')).json();expect(players.rows[0]).toMatchObject({username:'Viewer Rich',coins:1000000});expect(players.rows[0]).not.toHaveProperty('avatar');expect(players.rows[0]).not.toHaveProperty('hash');
  const result=await(await fetch(base+'/api/rows?table=profiles&search=Other')).json();expect(result.total).toBe(1);expect(result.rows[0].username).toBe('Viewer Other');
  for(const table of summary.tables){const response=await fetch(base+'/api/rows?table='+table.id);expect(response.status).toBe(200);expect((await response.json()).rows.length).toBeGreaterThan(0);}
});
test('viewer rejects mutations, nonlocal hosts, cross-site and forwarded requests',async()=>{
  expect((await fetch(base+'/api/rows',{method:'POST'})).status).toBe(405);
  for(const headers of [{host:'evil.example'},{origin:'https://evil.example'},{'x-forwarded-for':'127.0.0.1'},{'cf-connecting-ip':'192.0.2.1'},{'sec-fetch-site':'cross-site'}])expect(await new Promise<number|undefined>((resolve,reject)=>{const req=http.get(base+'/api/rows',{headers},response=>{response.resume();resolve(response.statusCode);});req.on('error',reject);}),JSON.stringify(headers)).toBe(403);
  expect((await fetch(base+'/api/rows?table=sessions')).status).toBe(400);
  expect((await fetch(base+'/api/rows?table=constructor')).status).toBe(400);
  const response=await fetch(base+'/');expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");expect(response.headers.get('cache-control')).toBe('no-store');
});
test('search and sort parameters cannot execute SQL or expose private tables',async()=>{
  const malicious="';drop table public.profiles;--";
  const response=await fetch(base+'/api/rows?'+new URLSearchParams({search:malicious,sort:malicious}));expect(response.status).toBe(200);expect((await response.json()).total).toBe(0);
  expect((await(await fetch(base+'/api/overview')).json()).users).toBe(2);
});
