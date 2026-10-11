import { createClient } from '@supabase/supabase-js';
import type { GameView, Profile, Room } from '../types';
import { read, write } from './storage';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = url && key ? createClient(url, key) : null;
export const localToken = () => read<string>('session', '');
async function localRequest<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/local/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localToken()}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(path === 'rpc' && (body as {fn?:string}).fn === 'save_deck' ? 60000 : 12000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'CONNECTION_ERROR');
  return data;
}
export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) return localRequest<T>('rpc', { fn, args });
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
async function loadProfile(username: string): Promise<Profile> {
  if (!supabase) { const data = await localRequest<{ token: string; profile: Profile }>('session', { username }); write('session',data.token); return data.profile; }
  const { data } = await supabase.auth.getSession();
  if (!data.session) { const result = await supabase.auth.signInAnonymously(); if (result.error) throw result.error; }
  return rpc<Profile>('ensure_profile', { p_username: username });
}
let pendingProfile: Promise<Profile> | null = null;
export function connectProfile(username: string) {
  pendingProfile ??= loadProfile(username).finally(() => { pendingProfile = null; });
  return pendingProfile;
}
export const createRecoveryCode = () => localRequest<{code:string}>('recovery-code',{});
export async function restoreProfile(code: string) {
  const data = await localRequest<{token:string;profile:Profile}>('recover',{code});
  write('session',data.token); return data.profile;
}
export const getRooms = () => rpc<Room[]>('list_rooms');
export const getGame = (id: string) => rpc<GameView>('get_game', { p_room: id });
export function localSocket(room: string, mode: 'watch' | 'voice', onMessage: (message: Record<string, any>) => void, onStatus?: (status: string) => void) {
  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/local/events`);
  socket.onopen = () => socket.send(JSON.stringify({ type: 'auth', token: localToken(), room, mode }));
  socket.onmessage = event => { try { const data = JSON.parse(event.data); if (data.type === 'ready') onStatus?.('SUBSCRIBED'); else if (data.type === 'error') onStatus?.('CHANNEL_ERROR'); else onMessage(data); } catch { return; } };
  socket.onerror = () => onStatus?.('CHANNEL_ERROR');
  socket.onclose = () => onStatus?.('CLOSED');
  return socket;
}
