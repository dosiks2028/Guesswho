import { beforeAll, afterAll, test, expect } from 'vitest';
import { createDatabase } from '../server/database.mjs';

let backend: Awaited<ReturnType<typeof createDatabase>>;
beforeAll(async()=>{backend=await createDatabase('memory://');},30000);
afterAll(()=>backend.close());

test('voice requires accepted friendship between the two room members, even after the match',async()=>{
  const a=await backend.session('','Voice Friend A'),b=await backend.session('','Voice Friend B'),c=await backend.session('','Voice Outsider');
  const room=await backend.call(a.profile.id,'create_room',{p_category:'naruto'});
  await backend.call(b.profile.id,'join_room',{p_code:room.code});
  expect(await backend.call(a.profile.id,'can_voice',{p_room:room.id})).toBe(false);
  await expect(backend.call(c.profile.id,'request_match_friend',{p_room:room.id})).rejects.toThrow('ROOM_NOT_FOUND');
  await backend.call(a.profile.id,'request_match_friend',{p_room:room.id});
  expect((await backend.call(a.profile.id,'get_game',{p_room:room.id})).friendship).toBe('outgoing');
  expect((await backend.call(b.profile.id,'get_game',{p_room:room.id})).friendship).toBe('incoming');
  expect(await backend.call(b.profile.id,'can_voice',{p_room:room.id})).toBe(false);
  await backend.call(b.profile.id,'respond_friend',{p_user:a.profile.id,p_accept:true});
  expect((await backend.call(a.profile.id,'get_game',{p_room:room.id}))).toMatchObject({voice_allowed:true,friendship:'friends'});
  expect(await backend.call(c.profile.id,'can_voice',{p_room:room.id})).toBe(false);
  await backend.call(a.profile.id,'leave_room',{p_room:room.id});
  expect(await backend.call(a.profile.id,'can_voice',{p_room:room.id})).toBe(true);
  await backend.call(b.profile.id,'remove_friend',{p_user:a.profile.id});
  expect(await backend.call(a.profile.id,'can_voice',{p_room:room.id})).toBe(false);
});

test('login and starting practice do not light a streak; finished practice counts once per day',async()=>{
  const a=await backend.session('','Daily Player'),b=await backend.session('','Daily Outsider');
  expect(await backend.call(a.profile.id,'streak_status')).toMatchObject({count:0,lit:false,reward:null,timezone:'UTC+5'});
  const ticket=await backend.call(a.profile.id,'start_practice_streak',{p_category:'naruto'});
  expect((await backend.call(a.profile.id,'streak_status')).lit).toBe(false);
  await expect(backend.call(b.profile.id,'finish_practice_streak',{p_ticket:ticket,p_outcome:'win'})).rejects.toThrow('INVALID_TICKET');
  await expect(backend.call(a.profile.id,'finish_practice_streak',{p_ticket:ticket,p_outcome:'abandoned'})).rejects.toThrow('INVALID_RESULT');
  expect(await backend.call(a.profile.id,'finish_practice_streak',{p_ticket:ticket,p_outcome:'loss'})).toMatchObject({count:1,best:1,lit:true,reward:{coins:25,gift:null}});
  await backend.call(a.profile.id,'finish_practice_streak',{p_ticket:ticket,p_outcome:'win'});
  const next=await backend.call(a.profile.id,'start_practice_streak',{p_category:'naruto'});
  await backend.call(a.profile.id,'finish_practice_streak',{p_ticket:next,p_outcome:'draw'});
  expect((await backend.call(a.profile.id,'ensure_profile')).coins).toBe(25);
  expect((await backend.db.query('select count(*)::int as n from game_private.daily_activity where user_id=$1',[a.profile.id])).rows[0].n).toBe(1);
});

test.each([[3,75,null],[7,150,'emoji-fire'],[14,300,'frame-lime'],[30,750,'frame-gold'],[35,225,null]])('streak day %s grants its automatic milestone',async(day,coins,gift)=>{
  const a=await backend.session('','Milestone '+day);
  await backend.db.query("update public.profiles set streak_count=$2,streak_best=$2,streak_day=(now() at time zone 'Asia/Almaty')::date-1 where id=$1",[a.profile.id,Number(day)-1]);
  const ticket=await backend.call(a.profile.id,'start_practice_streak',{p_category:'naruto'});
  const status=await backend.call(a.profile.id,'finish_practice_streak',{p_ticket:ticket,p_outcome:'win'});
  expect(status).toMatchObject({count:day,best:day,lit:true,reward:{coins,gift}});
  const profile=await backend.call(a.profile.id,'ensure_profile');expect(profile.coins).toBe(coins);
  if(gift)expect(profile.owned).toContain(gift);
});

test('missing a day resets the live streak while preserving the record and gifts',async()=>{
  const a=await backend.session('','Broken Streak');
  await backend.db.query("update public.profiles set streak_count=14,streak_best=14,streak_day=(now() at time zone 'Asia/Almaty')::date-2,owned=array['frame-lime'] where id=$1",[a.profile.id]);
  expect(await backend.call(a.profile.id,'streak_status')).toMatchObject({count:0,best:14,lit:false});
  const ticket=await backend.call(a.profile.id,'start_practice_streak',{p_category:'naruto'});
  expect(await backend.call(a.profile.id,'finish_practice_streak',{p_ticket:ticket,p_outcome:'win'})).toMatchObject({count:1,best:14,lit:true});
  expect((await backend.call(a.profile.id,'ensure_profile')).owned).toEqual(['frame-lime']);
});

test('concurrent practice completions grant a daily reward only once',async()=>{
  const a=await backend.session('','Concurrent Daily');
  const tickets=await Promise.all(['naruto','avengers'].map(p_category=>backend.call(a.profile.id,'start_practice_streak',{p_category})));
  await Promise.all(tickets.map(p_ticket=>backend.call(a.profile.id,'finish_practice_streak',{p_ticket,p_outcome:'win'})));
  expect((await backend.call(a.profile.id,'ensure_profile')).coins).toBe(25);
});
