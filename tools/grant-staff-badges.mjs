import {createDatabase} from '../server/database.mjs';
import {resolve} from 'node:path';
let running=false;try{running=(await fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(1000)})).ok;}catch{}
if(running)throw new Error('Stop the local server before editing its database');
const backend=await createDatabase(resolve(process.env.DATA_DIR||'server/.data'));
try{
  await backend.db.transaction(async tx=>{
    for(const [username,badge] of [['Bakdaulet','gold'],['Dos','violet']]){
      const result=await tx.query('update public.profiles set staff_badge=$1 where lower(username)=lower($2) returning username,staff_badge',[badge,username]);
      if(result.rows.length!==1)throw new Error(`Expected one matching profile for ${username}`);
      console.log(JSON.stringify(result.rows[0]));
    }
  });
}finally{await backend.close();}
