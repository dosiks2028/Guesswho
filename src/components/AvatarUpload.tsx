import { useRef, useState } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { useApp } from '../context';
import { Avatar, Modal } from './ui';
import { rpc } from '../lib/supabase';
import type { Profile } from '../types';
export function AvatarUpload() {
  const {profile,setProfile,online,t,toast}=useApp(); const input=useRef<HTMLInputElement>(null); const [preview,setPreview]=useState<string|null>(null); const [busy,setBusy]=useState(false);
  const choose=async(file?:File)=>{
    if(!file)return;
    if(!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)||file.size>8*1024*1024){toast(t('Выбери JPG, PNG или WebP до 8 МБ','Choose a JPG, PNG or WebP up to 8 MB'));return;}
    setBusy(true);
    try{const image=await createImageBitmap(file);const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;const ctx=canvas.getContext('2d')!;const side=Math.min(image.width,image.height);ctx.drawImage(image,(image.width-side)/2,(image.height-side)/2,side,side,0,0,256,256);image.close();setPreview(canvas.toDataURL('image/webp',.82));}catch{toast(t('Не удалось открыть изображение','Could not open the image'));}finally{setBusy(false);if(input.current)input.current.value='';}
  };
  const save=async(value:string|null)=>{setBusy(true);try{setProfile(await rpc<Profile>('update_avatar',{p_avatar:value}));setPreview(null);toast(t('Аватар обновлён','Avatar updated'));}catch{toast(t('Не удалось сохранить аватар','Could not save your avatar'));}finally{setBusy(false);}};
  return <><div className="avatar-upload"><Avatar name={profile.username} frame={profile.frame} src={profile.avatar} large/><button className="avatar-camera" aria-label={t('Загрузить фотографию','Upload photo')} disabled={!online||busy} onClick={()=>input.current?.click()}><Camera size={17}/></button><input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif" aria-label={t('Файл фотографии','Photo file')} hidden onChange={event=>void choose(event.target.files?.[0])}/></div>{preview&&<Modal title={t('Твоя новая фотография','Your new photo')} onClose={()=>setPreview(null)}><div className="avatar-preview"><img src={preview} alt={t('Предпросмотр аватара','Avatar preview')}/></div><p className="muted">{t('Фотография будет видна другим игрокам. Сохраняем в WebP, 256 × 256.','Your photo will be visible to other players. Saved as WebP, 256 × 256.')}</p><button className="button primary full" disabled={busy} onClick={()=>void save(preview)}>{t('Сохранить фотографию','Save photo')}</button></Modal>}{profile.avatar&&<button className="avatar-remove" aria-label={t('Убрать фотографию','Remove photo')} disabled={busy} onClick={()=>void save(null)}><Trash2 size={14}/></button>}</>;
}
