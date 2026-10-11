import { Handshake, Trophy } from 'lucide-react';
import { useApp } from '../context';

export function MatchMode({ ranked, onChange }: { ranked: boolean; onChange: (value: boolean) => void }) {
  const { t } = useApp();
  return <fieldset className="match-mode"><legend>{t('Режим игры','Match mode')}</legend><div className="visibility-options"><button type="button" className={ranked ? 'selected' : ''} aria-pressed={ranked} onClick={() => onChange(true)}><Trophy/><strong>{t('Рейтинговая','Ranked')}</strong><small>{t('Результат влияет на Elo','The result affects Elo')}</small></button><button type="button" className={!ranked ? 'selected' : ''} aria-pressed={!ranked} onClick={() => onChange(false)}><Handshake/><strong>{t('Дружеская','Friendly')}</strong><small>{t('Без изменений Elo','No Elo changes')}</small></button></div></fieldset>;
}
