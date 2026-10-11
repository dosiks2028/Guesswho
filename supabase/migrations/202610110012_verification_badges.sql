alter table public.profiles drop constraint profiles_staff_badge_check;
update public.profiles set staff_badge=case staff_badge when 'CEO' then 'gold' when 'Co-CEO' then 'violet' else null end;
alter table public.profiles add constraint profiles_staff_badge_check check(staff_badge in('gold','violet'));
