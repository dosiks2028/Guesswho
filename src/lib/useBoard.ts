import { useEffect, useRef, useState } from 'react';
import type { GameView } from '../types';
import { read, write } from './storage';
import { rpc } from './supabase';

export function useBoard(roomId: string | null, storageKey: string, view: GameView | null, onError: () => void) {
  const [closed, setClosed] = useState<string[]>(() => read(`${storageKey}:closed`, []));
  const current = useRef(closed);
  const version = useRef(-1);
  const pending = useRef(0);
  const queue = useRef(Promise.resolve());
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const update = (next: string[]) => {
    current.current = next;
    setClosed(next);
    if (!roomId) return;
    pending.current++;
    queue.current = queue.current.then(async () => {
      try {
        const saved = await rpc<{closed: string[]; version: number}>('set_board', {p_room: roomId, p_closed: next});
        version.current = saved.version;
      } catch {
        if (active.current) onError();
        version.current = -1;
      } finally { pending.current--; }
    });
  };
  useEffect(() => { write(`${storageKey}:closed`, closed); }, [closed, storageKey]);
  useEffect(() => {
    if (!roomId || !view || pending.current || view.own_board_version <= version.current) return;
    const first = version.current === -1;
    version.current = view.own_board_version;
    if (first && view.own_closed === null && current.current.length && view.room.status === 'playing') { update(current.current); return; }
    current.current = view.own_closed || [];
    setClosed(current.current);
  }, [roomId, view]);
  return { closed, changeClosed: (change: string[] | ((previous: string[]) => string[])) => update(typeof change === 'function' ? change(current.current) : change), flushBoard: () => queue.current };
}
