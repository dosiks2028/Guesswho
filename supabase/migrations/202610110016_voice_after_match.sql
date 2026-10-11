alter policy voice_read on realtime.messages to authenticated using (
  exists (select 1 from public.rooms where 'voice:' || id::text = realtime.topic() and auth.uid() in (host_id, guest_id))
);
alter policy voice_write on realtime.messages to authenticated with check (
  exists (select 1 from public.rooms where 'voice:' || id::text = realtime.topic() and auth.uid() in (host_id, guest_id))
);
