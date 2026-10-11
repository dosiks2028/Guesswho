import {beforeAll,afterAll,test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createDatabase} from '../server/database.mjs';
let backend:Awaited<ReturnType<typeof createDatabase>>;
beforeAll(async()=>{backend=await createDatabase('memory://');},30000);
afterAll(()=>backend.close());
async function duel(hostRating=1000,guestRating=1000){
  const a=await backend.session('','Rating Host');const b=await backend.session('','Rating Guest');
  await backend.db.query('update public.profiles set rating=$1 where id=$2',[hostRating,a.profile.id]);
  await backend.db.query('update public.profiles set rating=$1 where id=$2',[guestRating,b.profile.id]);
  const room=await backend.call(a.profile.id,'create_room',{p_category:'naruto',p_public:false});
  await backend.call(b.profile.id,'join_room',{p_code:room.code});
  await backend.call(a.profile.id,'select_secret',{p_room:room.id,p_character:'naruto-naruto-uzumaki'});
  await backend.call(b.profile.id,'select_secret',{p_room:room.id,p_character:'naruto-sasuke-uchiha'});
  await backend.db.query("update public.rooms set started_at=now()-interval '1 minute',moves=2 where id=$1",[room.id]);
  return {a,b,room};
}
test('equal ratings exchange 16 points once and weaker players gain more for an upset',async()=>{
  for(const [own,other,expected] of [[1000,1000,16],[1000,1400,29],[1400,1000,3]]){
    const {a,b,room}=await duel(own,other);
    await backend.call(a.profile.id,'guess_character',{p_room:room.id,p_character:'naruto-sasuke-uchiha'});
    const result=await backend.call(b.profile.id,'guess_character',{p_room:room.id,p_character:'naruto-itachi-uchiha'});
    expect(result.rating_changes[a.profile.id]).toBe(expected);expect(result.rating_changes[b.profile.id]).toBe(-expected);
    expect((await backend.call(a.profile.id,'ensure_profile')).rating).toBe(own+expected);
    await expect(backend.call(a.profile.id,'guess_character',{p_room:room.id,p_character:'naruto-sasuke-uchiha'})).rejects.toThrow('NOT_YOUR_TURN');
  }
});
test('a wrong guess cannot change rating, balance, wins or settle the game',async()=>{
  const {a,b,room}=await duel();
  await backend.call(a.profile.id,'guess_character',{p_room:room.id,p_character:'naruto-itachi-uchiha'});
  const p=await backend.call(a.profile.id,'ensure_profile');expect(p.rating).toBe(1000);expect(p.wins).toBe(0);expect(p.coins).toBe(0);
  const game=await backend.call(b.profile.id,'get_game',{p_room:room.id});expect(game.room.status).toBe('playing');expect(game.room.turn_id).toBe(b.profile.id);
});
test('five anime wins unlock Senpai and unearned titles cannot be forged',async()=>{
  const {a,b,room}=await duel();
  await expect(backend.call(a.profile.id,'equip_title',{p_title:'senpai'})).rejects.toThrow('NOT_OWNED');
  await backend.db.query('update public.profiles set category_wins=$1 where id=$2',[JSON.stringify({'naruto':2,'attack-on-titan':2}),a.profile.id]);
  await backend.call(a.profile.id,'guess_character',{p_room:room.id,p_character:'naruto-sasuke-uchiha'});
  await backend.call(b.profile.id,'guess_character',{p_room:room.id,p_character:'naruto-itachi-uchiha'});
  const p=await backend.call(a.profile.id,'equip_title',{p_title:'senpai'});expect(p.title).toBe('senpai');expect(p.category_wins.naruto).toBe(3);
  await expect(backend.call(a.profile.id,'equip_title',{p_title:'wizard'})).rejects.toThrow('NOT_OWNED');
});
test('forfeits update Elo but never grant coins or category achievements',async()=>{
  const {a,b,room}=await duel();await backend.call(a.profile.id,'leave_room',{p_room:room.id});
  const winner=await backend.call(b.profile.id,'ensure_profile');expect(winner.rating).toBe(1016);expect(winner.coins).toBe(0);expect(winner.category_wins).toEqual({});
});
test('avatars accept WebP and reject spoofed content and oversized data',async()=>{
  const a=await backend.session('','Avatar Player');
  const photo='data:image/webp;base64,'+readFileSync('public/images/naruto/naruto-uzumaki.webp').toString('base64');
  expect((await backend.call(a.profile.id,'update_avatar',{p_avatar:photo})).avatar).toBe(photo);
  await expect(backend.call(a.profile.id,'update_avatar',{p_avatar:'data:image/webp;base64,PHNjcmlwdD4='})).rejects.toThrow('INVALID_AVATAR');
  await expect(backend.call(a.profile.id,'update_avatar',{p_avatar:'data:image/svg+xml;base64,AAAA'})).rejects.toThrow('INVALID_AVATAR');
  await expect(backend.call(a.profile.id,'update_avatar',{p_avatar:'data:image/webp;base64,'+'A'.repeat(100000)})).rejects.toThrow('INVALID_AVATAR');
  expect((await backend.call(a.profile.id,'update_avatar',{p_avatar:null})).avatar).toBe(null);
});
test('leaderboard exposes only ranked public identity fields',async()=>{
  const a=await backend.session('','New Player');const entries=await backend.call(a.profile.id,'leaderboard');expect(entries.length).toBeGreaterThan(0);
  expect(entries.some(p=>p.id===a.profile.id)).toBe(false);
  expect(Object.keys(entries[0]).sort()).toEqual(['staff_badge','avatar','frame','id','rated_games','rating','title','username','wins'].sort());
  expect(entries[0].rating).toBeGreaterThanOrEqual(entries.at(-1).rating);
});
