import {beforeAll,afterAll,test,expect} from 'vitest';
import {createDatabase} from '../server/database.mjs';
let backend:Awaited<ReturnType<typeof createDatabase>>;
beforeAll(async()=>{backend=await createDatabase('memory://');},30000);
afterAll(()=>backend.close());
async function room(){
  const a=await backend.session('','Presence Host'),b=await backend.session('','Presence Guest');
  const r=await backend.call(a.profile.id,'create_room',{p_category:'naruto'});
  await backend.call(b.profile.id,'join_room',{p_code:r.code});
  await backend.call(a.profile.id,'room_presence',{p_room:r.id,p_connection:'a'});
  await backend.call(b.profile.id,'room_presence',{p_room:r.id,p_connection:'b'});
  await backend.call(a.profile.id,'select_secret',{p_room:r.id,p_character:'naruto-naruto-uzumaki'});
  await backend.call(b.profile.id,'select_secret',{p_room:r.id,p_character:'naruto-sasuke-uchiha'});
  return {a,b,r};
}
test('one disconnect gets a minute and reconnecting preserves the match',async()=>{
  const {a,b,r}=await room();
  await backend.call(a.profile.id,'room_presence',{p_room:r.id,p_connection:'a',p_online:false});
  await backend.db.query("update game_private.room_presence set last_seen=now()-interval '59 seconds' where room_id=$1 and user_id=$2",[r.id,a.profile.id]);
  await backend.db.query('select game_private.expire_rooms()');
  expect((await backend.call(b.profile.id,'get_game',{p_room:r.id})).room.status).toBe('playing');
  await backend.call(a.profile.id,'room_presence',{p_room:r.id,p_connection:'a-new'});
  await backend.db.query('select game_private.expire_rooms()');
  expect((await backend.call(b.profile.id,'get_game',{p_room:r.id})).room.status).toBe('playing');
});
test('one absent player after sixty seconds loses without a coin award',async()=>{
  const {a,b,r}=await room();
  await backend.call(a.profile.id,'room_presence',{p_room:r.id,p_connection:'a',p_online:false});
  await backend.db.query("update game_private.room_presence set last_seen=now()-interval '61 seconds' where room_id=$1 and user_id=$2",[r.id,a.profile.id]);
  await backend.db.query('select game_private.expire_rooms()');
  const game=await backend.call(b.profile.id,'get_game',{p_room:r.id});expect(game.room.status).toBe('finished');expect(game.room.winner_id).toBe(b.profile.id);
  expect((await backend.call(b.profile.id,'ensure_profile')).coins).toBe(0);
  expect((await backend.call(a.profile.id,'list_my_rooms')).some(item=>item.id===r.id)).toBe(false);
});
test('both players leaving closes immediately and other tabs keep a player connected',async()=>{
  const {a,b,r}=await room();
  await backend.call(a.profile.id,'room_presence',{p_room:r.id,p_connection:'a-tab-2'});
  await backend.call(a.profile.id,'room_presence',{p_room:r.id,p_connection:'a',p_online:false});
  await backend.call(b.profile.id,'room_presence',{p_room:r.id,p_connection:'b',p_online:false});
  expect((await backend.call(a.profile.id,'get_game',{p_room:r.id})).room.status).toBe('playing');
  await backend.call(a.profile.id,'room_presence',{p_room:r.id,p_connection:'a-tab-2',p_online:false});
  const state=await backend.call(a.profile.id,'get_game',{p_room:r.id});expect(state.room.status).toBe('finished');expect(state.room.outcome).toBe('cancelled');
  expect((await backend.call(a.profile.id,'ensure_profile')).games).toBe(0);
  const stranger=await backend.session('','Presence Outsider');await expect(backend.call(stranger.profile.id,'room_presence',{p_room:r.id,p_connection:'spy'})).rejects.toThrow('ROOM_NOT_FOUND');
});
