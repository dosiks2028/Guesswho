import { BadgeCheck } from 'lucide-react';
import { useApp } from '../context';
export function StaffBadge({value}:{value?:'gold'|'violet'|null}) {
  const {t}=useApp();
  return value ? <span className={`staff-badge ${value}`} role="img" aria-label={t('Подтверждённый профиль','Verified profile')} title={t('Подтверждённый профиль','Verified profile')}><BadgeCheck size={15}/></span> : null;
}
