create table game_private.shop_items(id text primary key,price integer not null check(price>0));
insert into game_private.shop_items(id,price) values('frame-lime',150),('frame-violet',250),('frame-gold',500),('emoji-fire',100),('emoji-brain',100),('emoji-crown',200),('emoji-devil',150),('emoji-clown',150),('emoji-skull',150),('emoji-yawn',100),('emoji-salt',100),('emoji-ez',250),('emoji-rage',120),('emoji-ice',120),('emoji-goat',200),('emoji-sus',100),('emoji-cry',100),('emoji-cook',150),('emoji-popcorn',100),('emoji-nerd',100),('emoji-smirk',100),('emoji-bye',100);
revoke all on game_private.shop_items from public,anon,authenticated;
create or replace function public.buy_item(p_item text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.profiles; cost integer;
begin
  select price into cost from game_private.shop_items where id=p_item;
  if cost is null then raise exception 'INVALID_ITEM'; end if;
  select * into p from public.profiles where id=auth.uid() for update;
  if p.id is null then raise exception 'UNAUTHORIZED'; end if;
  if p_item=any(p.owned) then return to_jsonb(p); end if;
  if p.coins<cost then raise exception 'INSUFFICIENT_COINS'; end if;
  update public.profiles set coins=coins-cost,owned=array_append(owned,p_item) where id=auth.uid() returning * into p;
  return to_jsonb(p);
end;
$$;
