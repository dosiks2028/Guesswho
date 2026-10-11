import { useState } from 'react';
import { Check, Search, Shuffle } from 'lucide-react';
import { useApp } from '../context';
import type { Category, Character } from '../types';
import { randomCharacter } from '../lib/game';

export function SecretSelection({ category, busy, current, onConfirm, onCancel }: { category: Category; busy: boolean; current?: string; onConfirm: (character: Character) => void; onCancel?: () => void }) {
  const { t } = useApp();
  const [selected, setSelected] = useState(current || '');
  const [search, setSearch] = useState('');
  const candidate = category.characters.find(character => character.id === selected);
  const characters = category.characters.filter(character => `${character.name} ${character.nameEn}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="secret-selection" aria-label={t('Выбор своего персонажа', 'Choose your character')}>
    <div className="secret-selection-heading"><span className="eyebrow">{t('ПЕРЕД НАЧАЛОМ ИГРЫ', 'BEFORE THE MATCH')}</span><h2>{t('Кого ты загадаешь?', 'Who will you pick?')}</h2><p>{t('Выбери любую карту и подтверди. Сопернику предстоит угадать именно этого персонажа.', 'Choose any card and confirm. Your opponent will try to guess this character.')}</p></div>
    <div className="secret-selection-tools"><label className="board-search"><Search size={16}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder={t('Имя персонажа', 'Character name')} aria-label={t('Найти своего персонажа', 'Find your character')}/></label><button className="button small" disabled={busy} onClick={() => setSelected(randomCharacter(category.characters).id)}><Shuffle size={16}/>{t('Случайный', 'Random')}</button></div>
    <div className="character-grid">{characters.map(character => <button className={`character-card secret-option ${selected === character.id ? 'chosen' : ''}`} key={character.id} disabled={busy} aria-pressed={selected === character.id} onClick={() => setSelected(character.id)} aria-label={t(character.name, character.nameEn)}><div className="character-image"><img src={character.img} alt="" loading="lazy" width="360" height="440"/>{selected === character.id && <span className="candidate-check"><Check size={20}/></span>}</div><span className="character-name">{t(character.name, character.nameEn)}</span></button>)}</div>
    {!characters.length && <p className="empty-search">{t('Никого не нашли. Попробуй другое имя.', 'No matches. Try another name.')}</p>}
    <div className="secret-confirm" aria-live="polite"><div className="secret-candidate">{candidate ? <img src={candidate.img} alt=""/> : <span className="secret-placeholder">?</span>}<div><small>{candidate ? t('Твой выбор', 'Your choice') : t('Твой секрет', 'Your secret')}</small><strong>{candidate ? t(candidate.name, candidate.nameEn) : t('Нажми на любую карту', 'Tap any card')}</strong></div></div><button className="button primary" disabled={!candidate || busy} onClick={() => candidate && onConfirm(candidate)}><Check size={18}/>{busy ? t('Сохраняем…', 'Saving…') : t('Загадать персонажа', 'Confirm character')}</button>{onCancel && <button className="button small" disabled={busy} onClick={onCancel}>{t('Отмена', 'Cancel')}</button>}</div>
  </section>;
}
