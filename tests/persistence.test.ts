import { test, expect } from 'vitest';
import { createDatabase } from '../server/database.mjs';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
test('database and session survive closing and reopening the server', async () => {
  const folder = await mkdtemp(join(tmpdir(),'guesswho-db-test-'));
  const first = await createDatabase(folder);
  const session = await first.session('', 'Persistent Detective');
  await first.call(session.profile.id,'update_profile',{p_username:'Saved Detective'});
  await first.close();
  const second = await createDatabase(folder);
  try {
    const restored = await second.session(session.token,'Should not replace');
    expect(restored.profile.id).toBe(session.profile.id);
    expect(restored.profile.username).toBe('Saved Detective');
  } finally { await second.close(); }
},30000);
