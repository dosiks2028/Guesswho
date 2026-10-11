import {beforeAll,afterAll,test,expect} from 'vitest';
import {createDatabase} from '../server/database.mjs';
import catalog from '../src/data/catalog.json';
let backend:Awaited<ReturnType<typeof createDatabase>>;
beforeAll(async()=>{backend=await createDatabase('memory://');},30000);
afterAll(()=>backend.close());
const category=()=>({...catalog[1],characters:catalog[1].characters.slice(0,6)});
async function match(){
  const a=await backend.session('','Chance Host'),b=await backend.session('','Chance Guest');
  const room=await backend.call(a.profile.id,'create_room',{p_category:'naruto',p_public:false});
  await backend.call(b.profile.id,'join_room',{p_code:room.code});
  await backend.call(a.profile.id,'select_secret',{p_room:room.id,p_character:'naruto-naruto-uzumaki'});
  await backend.call(b.profile.id,'select_secret',{p_room:room.id,p_character:'naruto-sasuke-uchiha'});
  await backend.db.query("update public.rooms set started_at=now()-interval '1 minute',moves=2 where id=$1",[room.id]);
  return {a,b,room};
}
test('names are unique ignoring case and new sessions never steal an existing name',async()=>{
  const a=await backend.session('','Unique Player'),b=await backend.session('','unique player');
  expect(a.profile.username.toLowerCase()).not.toBe(b.profile.username.toLowerCase());
  await expect(backend.call(b.profile.id,'update_profile',{p_username:' UNIQUE PLAYER '})).rejects.toThrow('USERNAME_TAKEN');
  expect((await backend.call(a.profile.id,'update_profile',{p_username:'UNIQUE PLAYER'})).username).toBe('UNIQUE PLAYER');
  await backend.call(b.profile.id,'update_profile',{p_username:'Renamed Player',staff_badge:'CEO'});
  expect((await backend.call(b.profile.id,'ensure_profile')).staff_badge).toBe(null);
});
test('correct guess grants exactly one final answer, a draw updates stats and Elo once',async()=>{
  const {a,b,room}=await match();
  await backend.db.query('update public.profiles set rating=1400 where id=$1',[a.profile.id]);
  expect(await backend.call(a.profile.id,'guess_character',{p_room:room.id,p_character:'naruto-sasuke-uchiha'})).toMatchObject({correct:true,last_chance:true,winner_id:null});
  expect((await backend.call(a.profile.id,'ensure_profile')).games).toBe(0);
  await expect(backend.call(b.profile.id,'pass_turn',{p_room:room.id})).rejects.toThrow('FINAL_GUESS_REQUIRED');
  await expect(backend.call(a.profile.id,'guess_character',{p_room:room.id,p_character:'naruto-sasuke-uchiha'})).rejects.toThrow('NOT_YOUR_TURN');
  const result=await backend.call(b.profile.id,'guess_character',{p_room:room.id,p_character:'naruto-naruto-uzumaki'});
  expect(result).toMatchObject({correct:true,draw:true,winner_id:null,reward:0});
  expect(result.rating_changes[a.profile.id]).toBe(-13);expect(result.rating_changes[b.profile.id]).toBe(13);
  const p=await backend.call(a.profile.id,'ensure_profile');expect(p).toMatchObject({wins:0,draws:1,games:1,coins:25});
  await expect(backend.call(b.profile.id,'guess_character',{p_room:room.id,p_character:'naruto-naruto-uzumaki'})).rejects.toThrow('NOT_YOUR_TURN');
  const history=await backend.call(a.profile.id,'match_history',{p_opponent:b.profile.id});expect(history).toMatchObject({games:1,wins:0,losses:0,draws:1});expect(history.matches[0].opponent_id).toBe(b.profile.id);
  const outsider=await backend.session('','History Outsider');expect((await backend.call(outsider.profile.id,'match_history',{p_opponent:a.profile.id})).games).toBe(0);
});
test('a failed final answer settles the original win and cannot change outcome on replay',async()=>{
  const {a,b,room}=await match();
  await backend.call(a.profile.id,'guess_character',{p_room:room.id,p_character:'naruto-sasuke-uchiha'});
  const result=await backend.call(b.profile.id,'guess_character',{p_room:room.id,p_character:'naruto-itachi-uchiha'});
  expect(result).toMatchObject({correct:false,draw:false,winner_id:a.profile.id,reward:50});
  expect((await backend.call(b.profile.id,'match_history',{p_opponent:a.profile.id})).losses).toBe(1);
});
test('decks validate images and lineup, protect edits, and snapshot private packs for invited players',async()=>{
  const a=await backend.session('','Pack Author'),b=await backend.session('','Pack Guest');
  const data=category();
  const id=await backend.call(a.profile.id,'save_deck',{p_data:data,p_published:false});
  await expect(backend.call(b.profile.id,'get_deck',{p_id:id})).rejects.toThrow('DECK_NOT_FOUND');
  await expect(backend.call(b.profile.id,'save_deck',{p_id:id,p_data:data})).rejects.toThrow('NOT_OWNED');
  await expect(backend.call(a.profile.id,'save_deck',{p_data:{...data,characters:data.characters.slice(0,5)}})).rejects.toThrow('INVALID_DECK_SIZE');
  await expect(backend.call(a.profile.id,'save_deck',{p_data:{...data,characters:data.characters.map(c=>({...c,img:'javascript:alert(1)'}))}})).rejects.toThrow('INVALID_IMAGE');
  const room=await backend.call(a.profile.id,'create_room',{p_category:id,p_public:false});
  const updated={...data,characters:data.characters.map(c=>({...c,id:'new-'+c.id}))};
  await backend.call(a.profile.id,'save_deck',{p_id:id,p_data:updated,p_published:true});
  await backend.call(b.profile.id,'join_room',{p_code:room.code});
  expect((await backend.call(b.profile.id,'get_room_deck',{p_room:room.id})).characters[0].id).toBe(data.characters[0].id);
  await backend.call(a.profile.id,'select_secret',{p_room:room.id,p_character:data.characters[0].id});
  await backend.call(b.profile.id,'select_secret',{p_room:room.id,p_character:data.characters[1].id});
  expect((await backend.call(a.profile.id,'get_game',{p_room:room.id})).room.deck).toBeUndefined();
  await expect(backend.call(a.profile.id,'guess_character',{p_room:room.id,p_character:updated.characters[1].id})).rejects.toThrow('INVALID_CHARACTER');
  expect((await backend.call(a.profile.id,'guess_character',{p_room:room.id,p_character:data.characters[1].id})).last_chance).toBe(true);
  expect((await backend.call(b.profile.id,'guess_character',{p_room:room.id,p_character:data.characters[0].id})).draw).toBe(true);
  await expect(backend.call(b.profile.id,'get_room_deck',{p_room:'00000000-0000-4000-8000-000000000000'})).rejects.toThrow('ROOM_NOT_FOUND');
});
test('votes are one per account, can be switched or removed, and cannot be self awarded',async()=>{
  const a=await backend.session('','Rated Author'),b=await backend.session('','Rated Reader');
  const id=await backend.call(a.profile.id,'save_deck',{p_data:category(),p_published:true});
  await expect(backend.call(a.profile.id,'vote_deck',{p_id:id,p_vote:1})).rejects.toThrow('INVALID_DECK');
  for(let i=0;i<2;i++)await backend.call(b.profile.id,'vote_deck',{p_id:id,p_vote:1});
  let entry=(await backend.call(b.profile.id,'list_decks')).find(d=>d.id===id);expect(entry.likes).toBe(1);expect(entry.my_vote).toBe(1);
  await backend.call(b.profile.id,'vote_deck',{p_id:id,p_vote:-1});entry=(await backend.call(b.profile.id,'list_decks')).find(d=>d.id===id);expect(entry.likes).toBe(0);expect(entry.dislikes).toBe(1);
  await backend.call(b.profile.id,'vote_deck',{p_id:id,p_vote:0});entry=(await backend.call(b.profile.id,'list_decks')).find(d=>d.id===id);expect(entry.dislikes).toBe(0);
});
