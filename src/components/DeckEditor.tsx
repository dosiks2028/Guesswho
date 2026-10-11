import { useEffect, useRef, useState } from 'react';
import { Plus, Upload, Trash2, Save, ArrowLeft } from 'lucide-react';
import { useApp } from '../context';
import type { Category, Character, DeckRecord } from '../types';
import { rpc } from '../lib/supabase';
import { portraitFromFile } from '../lib/portraits';
import { questions } from '../lib/game';
import { PageHeading } from './ui';

export function DeckEditor({ initial, onSaved, onClose }: { initial: DeckRecord | null; onSaved: (id: string) => void; onClose: () => void }) {
  const { t, profile, toast } = useApp();
  const own = initial?.owner_id === profile.id;
  const [deck, setDeck] = useState<Category>(() => initial ? { ...initial.data, title: own ? initial.data.title : `${initial.data.title} · remix`.slice(0,60), titleEn: own ? initial.data.titleEn : `${initial.data.titleEn} · remix`.slice(0,60) } : {id:'',title:'',titleEn:'',subtitle:'',subtitleEn:'',color:'#d7fa62',characters:[]});
  const [published, setPublished] = useState(own ? initial!.published : false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const photos = useRef<HTMLInputElement>(null);
  const editorPanel = useRef<HTMLElement>(null);
  useEffect(()=>{if(active && window.matchMedia('(max-width:600px)').matches)editorPanel.current?.scrollIntoView({behavior:'smooth',block:'start'});},[active]);
  const character = deck.characters.find(item => item.id === active);
  const patch = (id: string, change: Partial<Character>) => setDeck(previous => ({...previous,characters:previous.characters.map(item => item.id === id ? {...item,...change} : item)}));
  const add = () => { const id = crypto.randomUUID(); setDeck(previous => ({...previous,characters:[...previous.characters,{id,name:'',nameEn:'',img:'',traits:[]}]})); setActive(id); };
  const upload = async (files: FileList | null, id?: string) => {
    if (!files?.length) return;
    const available = id ? 1 : 64-deck.characters.length;
    if (files.length>available) { toast(t('Максимум 64 персонажа в колоде.', 'Maximum 64 characters per deck.')); return; }
    setBusy(true);
    try {
      const added: Character[] = [];
      for (const file of Array.from(files)) { const img = await portraitFromFile(file); if (id) patch(id,{img}); else { const name=file.name.replace(/\.[^.]+$/,'').replace(/[_-]/g,' ').slice(0,60); added.push({id:crypto.randomUUID(),name,nameEn:name,img,traits:[]}); } }
      if (added.length) setDeck(previous => ({...previous,characters:[...previous.characters,...added]}));
    } catch { toast(t('Не удалось загрузить фото. Нужен JPG, PNG или WebP до 8 МБ.', 'Could not load photo. Use JPG, PNG or WebP up to 8 MB.')); }
    finally { setBusy(false); if (photos.current) photos.current.value=''; }
  };
  const save = async () => {
    if (deck.title.trim().length<2 || deck.characters.length<6 || deck.characters.some(item => !item.name.trim() || !item.img)) { toast(t('Нужно название, от 6 до 64 персонажей, имя и фото у каждого.', 'Add a title, 6–64 characters, and a name and photo for each.')); return; }
    setBusy(true);
    try { const data={...deck,titleEn:deck.titleEn.trim() || deck.title,subtitleEn:deck.subtitleEn || deck.subtitle,characters:deck.characters.map(item => ({...item,nameEn:item.nameEn.trim() || item.name}))}; const id=await rpc<string>('save_deck',{p_id:own ? initial!.id : null,p_data:data,p_published:published}); toast(t('Колода сохранена', 'Deck saved')); onSaved(id); }
    catch(error) { toast((error as Error).message.includes('DECK_LIMIT') ? t('Можно сохранить до 20 своих колод.', 'You can save up to 20 decks.') : t('Не удалось сохранить колоду. Проверь имена, фотографии и подключение.', 'Could not save the deck. Check names, photos and connection.')); }
    finally { setBusy(false); }
  };
  return <><PageHeading eyebrow="DECK STUDIO" title={own ? t('Редактор колоды', 'Edit your deck') : t('Твоя новая вселенная', 'Your new universe')} text={t('Собери состав до матча. Изменения не затрагивают уже созданные комнаты.', 'Build the lineup before the match. Changes do not affect existing rooms.')}><button className="button" disabled={busy} onClick={onClose}><ArrowLeft size={17}/>{t('К колодам', 'Back to decks')}</button></PageHeading><div className="deck-editor-settings panel"><label>{t('Название', 'Title')}<input maxLength={60} value={deck.title} onChange={e=>setDeck({...deck,title:e.target.value})}/></label><label>{t('Название на английском · необязательно', 'English title · optional')}<input maxLength={60} value={deck.titleEn} onChange={e=>setDeck({...deck,titleEn:e.target.value})}/></label><label>{t('Описание', 'Description')}<textarea maxLength={200} value={deck.subtitle} onChange={e=>setDeck({...deck,subtitle:e.target.value})}/></label><label>{t('Описание на английском · необязательно', 'English description · optional')}<textarea maxLength={200} value={deck.subtitleEn} onChange={e=>setDeck({...deck,subtitleEn:e.target.value})}/></label><label>{t('Цвет', 'Color')}<input type="color" value={deck.color} onChange={e=>setDeck({...deck,color:e.target.value})}/></label><label className="publish-toggle"><input type="checkbox" checked={published} onChange={e=>setPublished(e.target.checked)}/>{t('Опубликовать для всех игроков', 'Publish for everyone')}</label></div><div className="deck-editor-toolbar"><strong>{deck.characters.length} / 64 {t('персонажей', 'characters')}</strong><button className="button" disabled={busy || deck.characters.length>=64} onClick={add}><Plus size={17}/>{t('Персонаж','Character')}</button><button className="button" disabled={busy || deck.characters.length>=64} onClick={()=>photos.current?.click()}><Upload size={17}/>{t('Загрузить фото','Upload photos')}</button><input hidden ref={photos} type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" onChange={e=>void upload(e.target.files)}/></div><p className="muted">{t('Можно загрузить сразу несколько фото. Конвертируем в WebP. Нажми на карту, чтобы изменить имя, фото и признаки для бота.', 'Upload several photos at once. We convert them to WebP. Select a card to edit its name, photo and traits for the bot.')}</p><div className="deck-editor-layout"><div className="editor-cards">{deck.characters.map(item=><button key={item.id} className={`editor-card ${active===item.id?'selected':''}`} disabled={busy} onClick={()=>setActive(item.id)}>{item.img ? <img src={item.img} alt=""/> : <span>?</span>}<strong>{item.name || t('Без имени','Unnamed')}</strong>{(!item.img || !item.name.trim()) && <small>{t('Нужно заполнить','Incomplete')}</small>}</button>)}</div>{character && <section ref={editorPanel} className="character-editor panel"><h3>{t('Карточка персонажа','Character card')}</h3><label>{t('Имя','Name')}<input maxLength={60} value={character.name} onChange={e=>patch(character.id,{name:e.target.value})}/></label><label>{t('Имя на английском','English name')}<input maxLength={60} value={character.nameEn} onChange={e=>patch(character.id,{nameEn:e.target.value})}/></label><label>{t('Фотография','Photo')}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={busy} onChange={e=>void upload(e.target.files,character.id)}/></label><div className="trait-options">{questions.map(question=><label key={question.key}><input type="checkbox" checked={character.traits.includes(question.key)} onChange={e=>patch(character.id,{traits:e.target.checked?[...character.traits,question.key]:character.traits.filter(trait=>trait!==question.key)})}/>{t(question.ru,question.en)}</label>)}</div><button className="button danger" disabled={busy} onClick={()=>{setDeck(previous=>({...previous,characters:previous.characters.filter(item=>item.id!==character.id)}));setActive(null);}}><Trash2 size={16}/>{t('Убрать персонажа','Remove character')}</button></section>}</div><div className="editor-save"><span>{published ? t('Колоду увидят и смогут оценить другие игроки.', 'Other players can discover and rate this deck.') : t('Личная колода. Друзья смогут играть по коду комнаты.', 'Private deck. Friends can play with a room code.')}</span><button className="button primary" disabled={busy} onClick={()=>void save()}><Save size={18}/>{busy ? t('Сохраняем…','Saving…') : t('Сохранить колоду','Save deck')}</button></div></>;
}
