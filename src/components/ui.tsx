import type { CSSProperties, ReactNode } from 'react';
import { ArrowUpRight, Coins, X, Sparkles } from 'lucide-react';
import { useApp } from '../context';
import type { Category } from '../types';
export function Coin({ amount }: { amount: number }) { return <span className="coins"><Coins size={17} /> {amount.toLocaleString()}</span>; }
export function Avatar({ name, frame = 'default', large = false, src }: { name: string; frame?: string; large?: boolean; src?:string|null }) { return <div className={`avatar ${large ? 'large' : ''} ${frame}`}>{src ? <img src={src} alt={name} width={large?92:35} height={large?92:35}/> : <span>{name.slice(0, 2).toUpperCase()}</span>}</div>; }
export function PageHeading({ eyebrow, title, text, children }: { eyebrow: string; title: string; text: string; children?: ReactNode }) { return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{text}</p></div>{children}</div>; }
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const { t } = useApp();
  return <div className="modal-backdrop" onClick={onClose}><section className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()} onKeyDown={event => {
    if (event.key === 'Escape') onClose();
    if (event.key === 'Tab') { const elements = event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,a[href]'); const first = elements[0], last = elements[elements.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
  }}><div className="modal-title"><h2>{title}</h2><button autoFocus className="icon-button" onClick={onClose} aria-label={t('Закрыть', 'Close')}><X /></button></div>{children}</section></div>;
}
export function DeckCard({ category, index, onClick }: { category: Category; index: number; onClick: () => void }) {
  const { t } = useApp();
  return <button className={`deck-card deck-${category.id}`} style={{ '--deck-color': category.color } as CSSProperties} onClick={onClick}>
    <div className="deck-art"><div className="deck-number">0{index + 1}</div><span className="deck-tag">{category.characters.length} {t('КАРТЫ', 'CARDS')}</span><div className="deck-portraits">{[2,0,1].map((n, i) => <img key={n} className={`portrait-${i}`} src={category.characters[n]?.img} alt="" loading="lazy" />)}</div><span className="deck-symbol">{['進撃', '忍者', 'ϟ', 'A'][index]}</span></div>
    <div className="deck-info"><div><h3>{t(category.title, category.titleEn)}</h3><p>{t(category.subtitle, category.subtitleEn)}</p></div><ArrowUpRight size={20} /></div>
  </button>;
}
export function SetupNotice() { const { t, navigate } = useApp(); return <div className="setup-notice"><Sparkles size={20}/><div><strong>{t('Арена готова к подключению', 'Your arena is ready to connect')}</strong><p>{t('Сервер пока недоступен. Проверь подключение или запусти start.bat на ноутбуке. Тренировка доступна.', 'The server is unavailable. Check your connection or run start.bat on the laptop. Practice is available.')}</p></div><button className="button small" onClick={() => navigate('/play')}>{t('Тренировка', 'Practice')}</button></div>; }
