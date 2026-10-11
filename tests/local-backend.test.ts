import { beforeAll, afterAll, test, expect } from 'vitest';
import { createDatabase } from '../server/database.mjs';
let backend: Awaited<ReturnType<typeof createDatabase>>;
beforeAll(async () => { backend = await createDatabase('memory://'); },30000);
afterAll(async () => { await backend.close(); });
test('browser sessions restore the same profile and reject forged tokens',async () => {
  const first = await backend.session('', 'Local Player');
  expect(first.token).toHaveLength(64);
  const second = await backend.session(first.token, 'Other Name');
  expect(second.profile.id).toBe(first.profile.id);
  expect(second.profile.username).toBe('Local Player');
  expect(await backend.authenticate('a'.repeat(64))).toBe(null);
});
test('local transport preserves membership and isolates simultaneous players',async () => {
  const a = await backend.session('', 'Player A'); const b = await backend.session('', 'Player B');
  const room = await backend.call(a.profile.id,'create_room',{p_category:'naruto',p_public:false});
  await backend.call(b.profile.id,'join_room',{p_code:room.code});
  await Promise.all([backend.call(a.profile.id,'select_secret',{p_room:room.id,p_character:'naruto-naruto-uzumaki'}),backend.call(b.profile.id,'select_secret',{p_room:room.id,p_character:'naruto-sasuke-uchiha'})]);
  const [stateA,stateB] = await Promise.all([backend.call(a.profile.id,'get_game',{p_room:room.id}),backend.call(b.profile.id,'get_game',{p_room:room.id})]);
  expect(stateA.secret).toBe('naruto-naruto-uzumaki'); expect(stateB.secret).toBe('naruto-sasuke-uchiha');
  expect(stateA.room.status).toBe('playing');
  const outsider = await backend.session('', 'Outsider');
  expect((await backend.call(a.profile.id,'list_my_rooms',{})).some(item => item.id === room.id)).toBe(true);
  expect(await backend.call(outsider.profile.id,'list_my_rooms',{})).toEqual([]);
  await expect(backend.call(outsider.profile.id,'get_game',{p_room:room.id})).rejects.toThrow('ROOM_NOT_FOUND');
});
test('RPC whitelist rejects arbitrary SQL function execution',async () => {
  const a = await backend.session('', 'Player');
  await expect(backend.call(a.profile.id,'pg_read_file',{})).rejects.toThrow('UNKNOWN_METHOD');
  await expect(backend.call(a.profile.id,'create_room);drop table public.profiles;--',{})).rejects.toThrow('UNKNOWN_METHOD');
  await expect(backend.call(null,'list_rooms',{})).rejects.toThrow('UNAUTHORIZED');
});
test('recovery codes restore a profile and rotation invalidates old codes',async () => {
  const a = await backend.session('', 'Recoverable Player');
  const code = await backend.createRecovery(a.profile.id);
  const restored = await backend.recover(code);
  expect(restored.profile.id).toBe(a.profile.id);
  expect(restored.token).not.toBe(a.token);
  const replacement = await backend.createRecovery(a.profile.id);
  await expect(backend.recover(code)).rejects.toThrow('INVALID_RECOVERY_CODE');
  expect((await backend.recover(replacement)).profile.id).toBe(a.profile.id);
});
