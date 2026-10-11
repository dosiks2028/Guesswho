import { useEffect, useState } from 'react';
import { useApp } from '../context';
import { rpc } from '../lib/supabase';
import type { MatchHistory } from '../types';

export function MatchStatistics() {
  const { t, lang, profile, online, path } = useApp();
  const [opponent, setOpponent] = useState(() => new URLSearchParams(path.split('?')[1]).get('opponent') || '');
  const [history, setHistory] = useState<MatchHistory | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!online) return;
    let active = true;
    setHistory(null); setError(false);
    rpc<MatchHistory>('match_history', { p_opponent: opponent || null }).then(value => { if (active) setHistory(value); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [opponent, online, profile.games]);
  const percentage = (count: number) => history?.games ? Math.round(count / history.games * 1000) / 10 : 0;
  return <section className="match-statistics panel"><div className="section-heading"><h2>{t('Результаты и личные встречи', 'Results & head-to-head')}</h2></div><label className="stats-filter">{t('Соперник', 'Opponent')}<select value={opponent} onChange={event => setOpponent(event.target.value)}><option value="">{t('Все соперники', 'All opponents')}</option>{opponent && !history?.opponents.some(player => player.id === opponent) && <option value={opponent}>{t('Выбранный игрок', 'Selected player')}</option>}{history?.opponents.map(player => <option key={player.id} value={player.id}>{player.username}</option>)}</select></label>{!history ? <p className="muted">{error ? t('Не удалось загрузить статистику.', 'Could not load statistics.') : !online ? t('Для статистики нужно подключение.', 'Connect to view statistics.') : t('Загружаем встречи…', 'Loading matches…')}</p> : <><div className="result-stat-grid">{[{key:'wins',label:t('Победы','Wins')},{key:'losses',label:t('Поражения','Losses')},{key:'draws',label:t('Ничьи','Draws')}].map(item => <div className={`result-stat ${item.key}`} key={item.key}><strong>{history[item.key as 'wins'|'losses'|'draws']}</strong><span>{item.label}</span><small>{percentage(history[item.key as 'wins'|'losses'|'draws'])}%</small></div>)}</div><div className="results-bar" aria-hidden="true"><span className="wins" style={{width:`${percentage(history.wins)}%`}}/><span className="draws" style={{width:`${percentage(history.draws)}%`}}/><span className="losses" style={{width:`${percentage(history.losses)}%`}}/></div><p className="muted">{history.games} {t('завершённых матчей. Отменённые комнаты не учитываются.', 'completed matches. Cancelled rooms are excluded.')}</p><div className="match-history">{history.matches.map(match => <article key={match.id}><div><strong>{match.opponent_name}</strong><small>{new Date(match.finished_at).toLocaleString(lang,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</small></div><span className={match.outcome === 'draw' ? 'draws' : match.winner_id === profile.id ? 'wins' : 'losses'}>{match.outcome === 'draw' ? t('Ничья','Draw') : match.winner_id === profile.id ? t('Победа','Win') : t('Поражение','Loss')}</span><small>{!match.is_ranked ? t('Дружеская','Friendly') : match.rating_change !== null ? `${Number(match.rating_change)>0?'+':''}${match.rating_change} Elo` : '—'}</small></article>)}</div>{!history.games && <p>{t('Здесь появится история ваших дуэлей.', 'Your duels will appear here.')}</p>}</>}</section>;
}
