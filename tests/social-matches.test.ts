import { beforeAll, afterAll, test, expect } from 'vitest';
import { createDatabase } from '../server/database.mjs';
import catalog from '../src/data/catalog.json';

let backend: Awaited<ReturnType<typeof createDatabase>>;
beforeAll(async () => { backend = await createDatabase('memory://'); }, 30000);
afterAll(() => backend.close());
async function match(ranked = false) {
  const a = await backend.session('', 'Social Host'), b = await backend.session('', 'Social Guest');
  const room = await backend.call(a.profile.id, 'create_room', {p_category: 'naruto', p_public: true, p_ranked: ranked});
  expect((await backend.call(b.profile.id, 'list_rooms')).find(r => r.id === room.id).is_ranked).toBe(ranked);
  await backend.call(b.profile.id, 'join_room', {p_code: room.code});
  await backend.call(a.profile.id, 'select_secret', {p_room: room.id, p_character: 'naruto-naruto-uzumaki'});
  await backend.call(b.profile.id, 'select_secret', {p_room: room.id, p_character: 'naruto-sasuke-uchiha'});
  await backend.db.query("update public.rooms set started_at=now()-interval '1 minute',moves=4 where id=$1", [room.id]);
  await backend.db.query('update public.profiles set rating=1400 where id=$1', [a.profile.id]);
  return {a, b, room};
}

test.each(['win', 'draw', 'forfeit', 'disconnect'])('friendly %s preserves both ratings and rated game counts', async outcome => {
  const {a,b,room} = await match();
  if (outcome === 'forfeit') await backend.call(b.profile.id, 'leave_room', {p_room: room.id});
  else if (outcome === 'disconnect') {
    await backend.call(a.profile.id,'room_presence',{p_room:room.id,p_connection:'host-check',p_online:true});
    await backend.db.query("update game_private.room_presence set last_seen=now()-interval '61 seconds' where room_id=$1 and user_id=$2",[room.id,b.profile.id]);
    await backend.db.query('select game_private.expire_rooms()');
  } else {
    await backend.call(a.profile.id, 'guess_character', {p_room: room.id, p_character: 'naruto-sasuke-uchiha'});
    await backend.call(b.profile.id, 'guess_character', {p_room: room.id, p_character: outcome === 'draw' ? 'naruto-naruto-uzumaki' : 'naruto-itachi-uchiha'});
  }
  const state = await backend.call(a.profile.id, 'get_game', {p_room: room.id});
  expect(state.room).toMatchObject({status:'finished',is_ranked:false,rating_changes:{}});
  expect(await backend.call(a.profile.id,'ensure_profile')).toMatchObject({rating:1400,rated_games:0,games:1});
  expect(await backend.call(b.profile.id,'ensure_profile')).toMatchObject({rating:1000,rated_games:0,games:1});
  expect((await backend.call(a.profile.id,'match_history')).matches[0].is_ranked).toBe(false);
  expect((await backend.call(b.profile.id,'ensure_profile')).coins).toBe(['win','draw'].includes(outcome)?25:0);
});

test('board updates share only card states, isolate players and validate the room deck', async () => {
  const {a,b,room} = await match();
  const outsider = await backend.session('', 'Board Outsider');
  const first = await backend.call(a.profile.id,'set_board',{p_room:room.id,p_closed:['naruto-itachi-uchiha','naruto-itachi-uchiha'],p_user:b.profile.id});
  expect(first).toEqual({closed:['naruto-itachi-uchiha'],version:1});
  const guestView = await backend.call(b.profile.id,'get_game',{p_room:room.id});
  expect(guestView.opponent_closed).toEqual(['naruto-itachi-uchiha']);
  expect(guestView.own_closed).toBe(null);
  expect(guestView.secret).toBe('naruto-sasuke-uchiha');
  expect(JSON.stringify(guestView)).not.toContain('naruto-naruto-uzumaki');
  expect((await backend.call(a.profile.id,'get_game',{p_room:room.id})).own_closed).toEqual(['naruto-itachi-uchiha']);
  await expect(backend.call(outsider.profile.id,'set_board',{p_room:room.id,p_closed:[]})).rejects.toThrow('ROOM_NOT_FOUND');
  await expect(backend.call(outsider.profile.id,'get_game',{p_room:room.id})).rejects.toThrow('ROOM_NOT_FOUND');
  for (const bad of [null,{},[1],Array(65).fill('naruto-itachi-uchiha')]) await expect(backend.call(a.profile.id,'set_board',{p_room:room.id,p_closed:bad})).rejects.toThrow('INVALID_BOARD');
  await expect(backend.call(a.profile.id,'set_board',{p_room:room.id,p_closed:['not-in-deck']})).rejects.toThrow('INVALID_CHARACTER');
  await backend.call(a.profile.id,'set_board',{p_room:room.id,p_closed:[]});
  expect((await backend.call(b.profile.id,'get_game',{p_room:room.id})).opponent_closed).toEqual([]);
  await backend.call(a.profile.id,'guess_character',{p_room:room.id,p_character:'naruto-itachi-uchiha'});
  expect((await backend.call(b.profile.id,'get_game',{p_room:room.id})).opponent_closed).toEqual(['naruto-itachi-uchiha']);
  await backend.call(a.profile.id,'leave_room',{p_room:room.id});
  await expect(backend.call(a.profile.id,'set_board',{p_room:room.id,p_closed:[]})).rejects.toThrow('INVALID_STATE');
});

test('friend invitations default to friendly and can explicitly opt into ranked', async () => {
  const a=await backend.session('','Friendly Inviter'),b=await backend.session('','Friendly Invitee');
  await backend.call(a.profile.id,'request_friend',{p_code:b.profile.friend_code});
  await backend.call(b.profile.id,'respond_friend',{p_user:a.profile.id,p_accept:true});
  for (const ranked of [false,true]) {
    const room=await backend.call(a.profile.id,'invite_friend',{p_user:b.profile.id,p_category:'naruto',...(ranked?{p_ranked:true}:{})});
    expect(room.is_ranked).toBe(ranked);
    const inbox=await backend.call(b.profile.id,'get_friends');
    const invite=inbox.invites.find(i=>i.room_id===room.id);
    expect(invite.is_ranked).toBe(ranked);
    expect((await backend.call(b.profile.id,'accept_invite',{p_invite:invite.id})).is_ranked).toBe(ranked);
    await backend.call(a.profile.id,'leave_room',{p_room:room.id});
  }
});

test('custom decks keep their board snapshot and friendly mode', async () => {
  const a=await backend.session('','Custom Social Host'),b=await backend.session('','Custom Social Guest');
  const data={...catalog[0],characters:catalog[0].characters.slice(0,6).map(c=>({...c,id:'custom-'+c.id}))};
  const id=await backend.call(a.profile.id,'save_deck',{p_data:data,p_published:false});
  const room=await backend.call(a.profile.id,'create_room',{p_category:id,p_public:false,p_ranked:false});
  await backend.call(b.profile.id,'join_room',{p_code:room.code});
  await backend.call(a.profile.id,'select_secret',{p_room:room.id,p_character:data.characters[0].id});
  await backend.call(b.profile.id,'select_secret',{p_room:room.id,p_character:data.characters[1].id});
  await backend.call(a.profile.id,'set_board',{p_room:room.id,p_closed:[data.characters[2].id]});
  expect((await backend.call(b.profile.id,'get_game',{p_room:room.id})).opponent_closed).toEqual([data.characters[2].id]);
  await expect(backend.call(a.profile.id,'set_board',{p_room:room.id,p_closed:[catalog[0].characters[0].id]})).rejects.toThrow('INVALID_CHARACTER');
});
