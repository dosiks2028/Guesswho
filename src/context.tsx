import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { Lang, Profile } from './types';
import { read, write } from './lib/storage';
import { connectProfile, supabase } from './lib/supabase';
import { sound } from './lib/audio';

type AppContextType = { lang: Lang; setLang: (lang: Lang) => void; t: (ru: string, en: string) => string; profile: Profile; setProfile: (p: Profile) => void; refresh: () => Promise<void>; toast: (text: string) => void; online: boolean; path: string; navigate: (path: string) => void };
const Context = createContext<AppContextType>(null!);
export const useApp = () => useContext(Context);
const initialProfile: Profile = { id: 'local', username: 'Detective', coins: 0, wins: 0, games: 0, frame: 'default', owned: [], rating:1000, rated_games:0, category_wins:{}, title:'rookie' };
export function AppProvider({ children }: { children: ReactNode }) {
  const [lang, updateLang] = useState<Lang>(read('lang', 'ru'));
  const [profile, updateProfile] = useState<Profile>({ ...initialProfile, username: read('username', 'Detective') });
  const [online, setOnline] = useState(false);
  const [notice, setNotice] = useState('');
  const [path, setPath] = useState(location.pathname + location.search);
  const toast = useCallback((text: string) => setNotice(text), []);
  const t = (ru: string, en: string) => lang === 'ru' ? ru : en;
  const setProfile = (p: Profile) => { updateProfile(p); write('username', p.username); };
  const refresh = useCallback(async () => {
    try { updateProfile(await connectProfile(read('username', 'Detective'))); setOnline(true); }
    catch { setOnline(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { document.documentElement.lang = lang; write('lang', lang); }, [lang]);
  useEffect(() => { if (!notice) return; const timeout = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(timeout); }, [notice]);
  useEffect(() => {
    const pop = () => setPath(location.pathname + location.search);
    const click = (event: MouseEvent) => { if ((event.target as HTMLElement).closest('button,a,input[type=checkbox],select')) sound(); };
    addEventListener('popstate', pop); document.addEventListener('click', click);
    return () => { removeEventListener('popstate', pop); document.removeEventListener('click', click); };
  }, []);
  const navigate = (url: string) => { history.pushState({}, '', url); setPath(url); window.scrollTo({ top: 0 }); };
  return <Context.Provider value={{ lang, setLang: updateLang, t, profile, setProfile, refresh, toast, online, path, navigate }}>{children}{notice && <div className="toast" role="status">{notice}</div>}</Context.Provider>;
}
