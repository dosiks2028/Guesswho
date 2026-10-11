import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { Check, Flame, Gift } from 'lucide-react';
import { useApp } from '../context';
import { rpc } from '../lib/supabase';
import { Coin, Modal } from './ui';
import type { StreakStatus } from '../types';

const dayWord = (value: number) => value % 100 >= 11 && value % 100 <= 14 ? 'дней' : value % 10 === 1 ? 'день' : value % 10 >= 2 && value % 10 <= 4 ? 'дня' : 'дней';

const milestones = [
  {day:1,coins:25,ru:'Первый огонёк',en:'First spark'},
  {day:3,coins:75,ru:'Набираешь темп',en:'Building momentum'},
  {day:7,coins:150,ru:'Реакция 🔥 в подарок',en:'Gift: 🔥 reaction'},
  {day:14,coins:300,ru:'Неоновая рамка в подарок',en:'Gift: neon frame'},
  {day:30,coins:750,ru:'Золотая рамка в подарок',en:'Gift: gold frame'},
];

export function DailyStreak() {
  const { t, lang, profile, online, toast, navigate } = useApp();
  const [status, setStatus] = useState<StreakStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [error,setError] = useState(false);
  const previous = useRef<StreakStatus | null>(null);
  useEffect(() => { previous.current = null; setStatus(null); }, [profile.id]);
  useEffect(() => {
    if (!online) return;
    let active=true;
    const load=async()=>{try{const next=await rpc<StreakStatus>('streak_status');if(!active)return;if(previous.current && !previous.current.lit && next.lit)toast(lang==='ru'?`Огонёк зажжён! Серия: ${next.count}. +${next.reward?.coins || 0} монет${next.reward?.gift?' и подарок!':''}`:`Streak lit! ${next.count} days. +${next.reward?.coins || 0} coins${next.reward?.gift?' and a gift!':''}`);previous.current=next;setStatus(next);setError(false);}catch{if(active)setError(true);}};
    void load(); const timer=setInterval(()=>void load(),60000);const focus=()=>{if(document.visibilityState==='visible')void load();};document.addEventListener('visibilitychange',focus);
    return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',focus);};
  },[online,profile.id,profile.games,profile.coins,lang,toast,open]);
  return <><button className={`streak-button ${status?.lit ? 'lit' : ''}`} onClick={()=>setOpen(true)} aria-label={t(`Огонёк: ${status?.count || 0} ${dayWord(status?.count || 0)}. ${status?.lit ? 'Сегодня зажжён' : 'Сыграй матч сегодня'}`,`Streak: ${status?.count || 0} days. ${status?.lit ? 'Lit today' : 'Play a match today'}`)}><Flame size={20}/><strong>{status?.count || 0}</strong></button>{open && createPortal(<Modal title={t('Твой ежедневный огонёк','Your daily streak')} onClose={()=>setOpen(false)}>{!status || !online || error ? <p className="muted">{!online || error ? t('Подключись к серверу, чтобы увидеть серию.','Connect to the server to view your streak.') : t('Загружаем серию…','Loading streak…')}</p> : <><div className={`streak-hero ${status.lit ? 'lit' : ''}`}><Flame size={56}/><strong>{status.count}</strong><span>{t(`${dayWord(status.count)} подряд`,status.count===1?'day in a row':'days in a row')}</span><p>{status.lit ? t('Сегодня огонёк зажжён!','Your streak is lit today!') : t('Заверши матч сегодня, чтобы зажечь огонёк.','Finish a match today to light your streak.')}</p></div><p className="muted">{t('Засчитывается победа, поражение или ничья: с ботом, с другом или в рейтинге. Выход из игры не засчитывается. Нужна связь с сервером.','A win, loss or draw counts: against a bot, with a friend or in ranked. Leaving does not count. A server connection is required.')}</p><div className="streak-week">{Array.from({length:7},(_,i)=>{const day=new Date(`${status.today}T12:00:00Z`);day.setUTCDate(day.getUTCDate()-6+i);const key=day.toISOString().slice(0,10);const lit=status.recent.includes(key);return <div key={key} className={lit?'lit':''}><small>{day.toLocaleDateString(lang,{weekday:'short',timeZone:'UTC'})}</small>{lit?<Flame size={22}/>:<span>·</span>}</div>;})}</div>{status.reward && <div className="streak-received"><Check size={17}/><span>{t('Сегодня начислено','Awarded today')}</span><Coin amount={status.reward.coins}/>{status.reward.gift && <Gift size={19}/>}</div>}<div className="streak-rewards">{milestones.map(m=><div key={m.day} className={status.count>=m.day?'earned':''}><span>{status.count>=m.day?<Check size={18}/>:<Gift size={18}/>}</span><div><strong>{m.day} {t(dayWord(m.day),m.day===1?'day':'days')}</strong><small>{t(m.ru,m.en)}</small></div><Coin amount={m.coins}/></div>)}</div><p className="muted">{t('В остальные дни — 25 монет. После 30 дней каждый 7-й день — 225 монет. Награды начисляются автоматически один раз в день; подарки остаются в коллекции.','Other days award 25 coins. After day 30, every 7th day awards 225 coins. Rewards are automatic once per day; gifts stay in your collection.')}</p><p className="streak-footnote">{t('Новый день в 00:00 (UTC+5). Пропуск дня обнуляет серию. Рекорд:','A new day starts at 00:00 (UTC+5). Missing a day resets the streak. Best:')} {status.best}</p>{!status.lit && <button className="button primary full" onClick={()=>{setOpen(false);navigate('/play');}}>{t('Зажечь огонёк','Light the streak')}<Flame size={17}/></button>}</>}</Modal>,document.body)}</>;
}
