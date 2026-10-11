import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';

const db = new PGlite();
const host = '11111111-1111-4111-8111-111111111111';
const guest = '22222222-2222-4222-8222-222222222222';
const outsider = '33333333-3333-4333-8333-333333333333';
const user = (id: string) => db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
async function rpc(name: string, values: unknown[] = []) {
  const result = await db.query<{ value: any }>(`select public.${name}(${values.map((_,i) => '$' + (i+1)).join(',')}) as value`, values);
  return result.rows[0]?.value;
}
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated; create schema realtime; create table realtime.messages(id uuid); create function realtime.topic() returns text language sql stable as $$ select ''::text $$;`);
  for (const file of readdirSync('supabase/migrations').filter(file => file.endsWith('.sql')).sort()) await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8').replace('alter publication supabase_realtime add table public.rooms, public.game_messages;', ''));
  for (const id of [host, guest, outsider]) { await db.query('insert into auth.users values ($1)', [id]); await user(id); await rpc('ensure_profile', [id === host ? 'Host' : id === guest ? 'Guest' : 'Outsider']); }
}, 30000);
afterAll(() => db.close());
describe('authoritative multiplayer and economy', () => {
  let room: any;
  test('rejects anonymous calls without an authenticated identity', async () => {
    await user('');
    await expect(rpc('list_rooms')).rejects.toThrow('UNAUTHORIZED');
    await expect(rpc('create_room',['naruto',true])).rejects.toThrow('UNAUTHORIZED');
  });
  test('creates private rooms and keeps them out of the public lobby', async () => {
    await user(host); room = await rpc('create_room',['naruto',false]);
    expect(room.code).toMatch(/^[A-F0-9]{8}$/);
    expect(await rpc('list_rooms')).toEqual([]);
    await user(outsider);
    await expect(rpc('join_room',[null,room.id])).rejects.toThrow('ROOM_NOT_FOUND');
    await expect(rpc('get_game',[room.id])).rejects.toThrow('ROOM_NOT_FOUND');
  });
  test('host can choose a secret before the opponent joins', async () => {
    await user(host); await rpc('select_secret',[room.id,'naruto-naruto-uzumaki']);
    expect((await rpc('get_game',[room.id])).room.host_ready).toBe(true);
  });
  test('joining consumes the only guest slot and secrets stay private', async () => {
    await user(guest); await rpc('join_room',[room.code.toLowerCase(),null]);
    await rpc('select_secret',[room.id,'naruto-sasuke-uchiha']);
    const state = await rpc('get_game',[room.id]);
    expect(state.secret).toBe('naruto-sasuke-uchiha');
    expect(JSON.stringify(state)).not.toContain('naruto-naruto-uzumaki');
    expect(state.room.status).toBe('playing');
    await user(outsider); await expect(rpc('join_room',[room.code,null])).rejects.toThrow('ROOM_FULL');
  });
  test('checks turns and rejects invalid characters', async () => {
    await user(guest); await expect(rpc('guess_character',[room.id,'naruto-naruto-uzumaki'])).rejects.toThrow('NOT_YOUR_TURN');
    await expect(rpc('pass_turn',[room.id])).rejects.toThrow('NOT_YOUR_TURN');
    await user(host); await expect(rpc('guess_character',[room.id,'fake'])).rejects.toThrow('INVALID_CHARACTER');
    await expect(rpc('select_secret',[room.id,'naruto-sasuke-uchiha'])).rejects.toThrow('INVALID_STATE');
  });
  test('stores chat, enforces membership, message limits and rate limits', async () => {
    await user(outsider); await expect(rpc('send_message',[room.id,'hello'])).rejects.toThrow('UNAUTHORIZED');
    await user(host); await expect(rpc('send_message',[room.id,'x'.repeat(301)])).rejects.toThrow('INVALID_MESSAGE');
    await rpc('send_message',[room.id,'<script>alert(1)</script>']);
    await expect(rpc('send_message',[room.id,'spam'])).rejects.toThrow('RATE_LIMIT');
    await user(guest); expect((await rpc('get_game',[room.id])).messages[0].body).toBe('<script>alert(1)</script>');
  });
  test('pays one reward after a valid match and cannot settle it twice', async () => {
    await user(host); await rpc('pass_turn',[room.id]);
    await user(guest); await rpc('pass_turn',[room.id]);
    await db.query("update public.rooms set started_at = now() - interval '1 minute' where id=$1", [room.id]);
    await user(host); await rpc('guess_character',[room.id,'naruto-sasuke-uchiha']);
    await user(guest); const result = await rpc('guess_character',[room.id,'naruto-itachi-uchiha']);
    await user(host);
    expect(result).toMatchObject({correct:false,winner_id:host,reward:50,rating_changes:{[host]:16,[guest]:-16}});
    await expect(rpc('guess_character',[room.id,'naruto-sasuke-uchiha'])).rejects.toThrow('NOT_YOUR_TURN');
    const p = await rpc('ensure_profile',['Ignored']); expect(p.coins).toBe(75); expect(p.wins).toBe(1); expect(p.games).toBe(1);
    await user(guest); expect((await rpc('ensure_profile',['Ignored'])).games).toBe(1);
  });
  test('cannot forge balances, read opponent profiles, or read private secrets', async () => {
    await user(guest); await db.exec('set role authenticated');
    try {
      await expect(db.query('update public.profiles set coins=99999 where id=$1',[guest])).rejects.toThrow('permission denied');
      expect((await db.query('select * from public.profiles where id=$1',[host])).rows).toHaveLength(0);
      await expect(db.query('select * from game_private.secrets')).rejects.toThrow('permission denied');
    } finally { await db.exec('reset role'); }
  });
  test('purchases are atomic and owned items cannot be charged twice', async () => {
    await user(host); await expect(rpc('buy_item',['frame-gold'])).rejects.toThrow('INSUFFICIENT_COINS');
    await expect(rpc('equip_frame',['frame-gold'])).rejects.toThrow('NOT_OWNED');
    await db.query('update public.profiles set coins=300 where id=$1',[host]);
    const first = await rpc('buy_item',['frame-lime']); expect(first.coins).toBe(150);
    const second = await rpc('buy_item',['frame-lime']); expect(second.coins).toBe(150); expect(second.owned).toEqual(['frame-lime']);
    expect((await rpc('equip_frame',['frame-lime'])).frame).toBe('frame-lime');
    await expect(rpc('buy_item',['fake'])).rejects.toThrow('INVALID_ITEM');
  });
  test('wrong guesses keep the match alive, pass the turn and award nothing', async () => {
    await user(host); const r = await rpc('create_room',['naruto',true]);
    await rpc('select_secret',[r.id,'naruto-naruto-uzumaki']);
    await user(guest); await rpc('join_room',[r.code,null]); await rpc('select_secret',[r.id,'naruto-sasuke-uchiha']);
    await user(host); const result = await rpc('guess_character',[r.id,'naruto-itachi-uchiha']);
    expect(result).toMatchObject({correct:false,winner_id:null,reward:0});
    const state = await rpc('get_game',[r.id]);
    expect(state.room.status).toBe('playing'); expect(state.room.turn_id).toBe(guest); expect(state.room.winner_id).toBe(null);
    await expect(rpc('guess_character',[r.id,'naruto-sasuke-uchiha'])).rejects.toThrow('NOT_YOUR_TURN');
    await user(guest); await rpc('pass_turn',[r.id]);
    await user(host); expect((await rpc('guess_character',[r.id,'naruto-sasuke-uchiha'])).correct).toBe(true);
  });
  test('leaving closes a room and no one can join it again', async () => {
    await user(host); const r = await rpc('create_room',['harry-potter',true]); await rpc('leave_room',[r.id]);
    await user(guest); await expect(rpc('join_room',[r.code,null])).rejects.toThrow('ROOM_FULL');
  });
});
