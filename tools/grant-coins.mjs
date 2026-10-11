import {createDatabase} from '../server/database.mjs';
import {resolve} from 'node:path';
const username=process.argv[2];const amount=Number(process.argv[3]);
if(!username||!Number.isSafeInteger(amount)||amount<=0||amount>10000000)throw new Error('Usage: node tools/grant-coins.mjs PLAYER_NAME AMOUNT');
let running=false;try{running=(await fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(1000)})).ok;}catch{}
if(running)throw new Error('Stop the local server before editing its database');
const backend=await createDatabase(resolve(process.env.DATA_DIR||'server/.data'));
try{
  const players=await backend.db.query('select id,username,coins from public.profiles where lower(username)=lower($1)',[username]);
  if(players.rows.length!==1)throw new Error(`Expected one matching player, found ${players.rows.length}`);
  const result=await backend.db.query('update public.profiles set coins=coins+$1 where id=$2 returning username,coins',[amount,players.rows[0].id]);
  console.log(JSON.stringify(result.rows[0]));
}finally{await backend.close();}
