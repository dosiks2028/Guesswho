import http from 'node:http';
import { readFile } from 'node:fs/promises';

const tables = {
  profiles: {name:'Пользователи',query:'select id,username,coins,rating,wins,games,draws,rated_games,streak_count,streak_best,streak_day,staff_badge,frame,owned,friend_code,created_at from public.profiles',columns:['username','coins','rating','wins','games','draws','streak_count','created_at'],search:['username','id'],sort:'coins'},
  rooms: {name:'Матчи и комнаты',query:'select r.id,r.code,r.host_name,r.guest_name,r.category,r.status,r.outcome,r.is_ranked,r.moves,p.username as winner,r.rating_changes,r.created_at,r.finished_at from public.rooms r left join public.profiles p on p.id=r.winner_id',columns:['code','host_name','guest_name','category','status','is_ranked','outcome','created_at'],search:['code','host_name','guest_name','category','id'],sort:'created_at'},
  friendships: {name:'Друзья и заявки',query:'select f.requester,f.recipient,a.username as sender,b.username as recipient_name,f.status,f.created_at from game_private.friendships f join public.profiles a on a.id=f.requester join public.profiles b on b.id=f.recipient',columns:['sender','recipient_name','status','created_at'],search:['sender','recipient_name'],sort:'created_at'},
  decks: {name:'Колоды',query:"select d.id,d.data->>'title' as title,p.username as author,d.published,jsonb_array_length(d.data->'characters') as cards,(select count(*)::int from public.deck_votes v where v.deck_id=d.id and v.vote=1) as likes,(select count(*)::int from public.deck_votes v where v.deck_id=d.id and v.vote=-1) as dislikes,d.created_at,d.updated_at from public.decks d left join public.profiles p on p.id=d.owner_id",columns:['title','author','cards','published','likes','dislikes','updated_at'],search:['title','author','id'],sort:'updated_at'},
  daily_activity: {name:'Награды огонька',query:'select a.user_id,p.username,a.day,a.streak,a.coins,a.gift from game_private.daily_activity a join public.profiles p on p.id=a.user_id',columns:['username','day','streak','coins','gift'],search:['username','gift'],sort:'day'},
};

export function createDatabaseViewer(db) {
  const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
  return http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const port=req.socket.localPort;
    const hosts=[`127.0.0.1:${port}`,`localhost:${port}`];
    const host=req.headers.host;
    if(!hosts.includes(host) || !['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || req.headers['x-forwarded-for'] || req.headers['forwarded'] || req.headers['cf-connecting-ip'] || (req.headers.origin && req.headers.origin!==`http://${host}`) || req.headers['sec-fetch-site']==='cross-site')return json(res,403,{error:'Доступ только с этого ноутбука'});
    if(req.method!=='GET')return json(res,405,{error:'Панель доступна только для просмотра'});
    try {
      const url=new URL(req.url,`http://${host}`);
      if(url.pathname==='/api/overview') {
        const result=await db.query('select (select count(*)::int from public.profiles) as users,(select coalesce(sum(coins),0)::bigint from public.profiles) as coins,(select count(*)::int from public.rooms) as matches,(select count(*)::int from public.decks) as decks');
        return json(res,200,{...result.rows[0],tables:Object.entries(tables).map(([id,t])=>({id,name:t.name}))});
      }
      if(url.pathname==='/api/rows') {
        const tableId=url.searchParams.get('table') || 'profiles';
        const table=Object.hasOwn(tables,tableId)?tables[tableId]:null;
        if(!table)return json(res,400,{error:'Неизвестная таблица'});
        const sort=table.columns.includes(url.searchParams.get('sort'))?url.searchParams.get('sort'):table.sort;
        const direction=url.searchParams.get('direction')==='asc'?'asc':'desc';
        const page=Math.max(0,Math.min(100000,Number.parseInt(url.searchParams.get('page')||'0',10)||0));
        const search=(url.searchParams.get('search')||'').trim().slice(0,100);
        const pattern=`%${search.replace(/[\\%_]/g,'\\$&')}%`;
        const where=search?'where ('+table.search.map(c=>`coalesce(${c}::text,'') ilike $1`).join(' or ')+')':'';
        const values=search?[pattern]:[];
        const result=await db.transaction(async tx=>{
          await tx.exec('set transaction read only');
          const count=await tx.query(`select count(*)::int as total from (${table.query}) data ${where}`,values);
          const rows=await tx.query(`select * from (${table.query}) data ${where} order by ${sort} ${direction} nulls last,1 asc limit 50 offset $${values.length+1}`,[...values,page*50]);
          return {rows:rows.rows,total:count.rows[0].total};
        });
        return json(res,200,{...result,columns:table.columns,page,pageSize:50,sort,direction,name:table.name});
      }
      const files={'/':['db-viewer.html','text/html; charset=utf-8'],'/viewer.css':['db-viewer.css','text/css; charset=utf-8'],'/viewer.js':['db-viewer.js','text/javascript; charset=utf-8']};
      if(!files[url.pathname])return json(res,404,{error:'Страница не найдена'});
      const [file,type]=files[url.pathname];
      res.setHeader('Content-Type',type);res.end(await readFile(new URL(file,import.meta.url)));
    } catch { json(res,500,{error:'Не удалось прочитать базу. Обновите страницу.'}); }
  });
}
