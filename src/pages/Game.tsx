import { useBoard } from '../lib/useBoard';
import { MatchTools, OpponentBoard } from '../components/MatchTools';
import { StaffBadge } from '../components/StaffBadge';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Copy, Eye, EyeOff, Flag, MessageCircle, RotateCcw, Search, Send, Smile, Swords, Target, Trophy, Users, X } from 'lucide-react';
import { useApp } from '../context';
import type { Category, Character, DeckRecord, GameView, Message, Room } from '../types';
import { Avatar, Coin, DeckCard, Modal, PageHeading } from '../components/ui';
import { randomCharacter, questions, toggleCard, shopItems } from '../lib/game';
import { sound } from '../lib/audio';
import { read, write } from '../lib/storage';
import { getGame, rpc, supabase, localSocket } from '../lib/supabase';
import { titleById } from '../lib/achievements';
import { SecretSelection } from '../components/SecretSelection';
import { VoiceChat } from '../lib/voice';

const chatSegments = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const chatEmoji = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u;
function chatBody(body: string) {
  return Array.from(chatSegments.segment(body), ({ segment, index }) => chatEmoji.test(segment) ? <span className="chat-emoji" key={index}>{segment}</span> : segment);
}

type Practice = { streakTicket?: string; streakRecorded?: boolean; secret: string; target: string; messages: Message[]; asked: string[]; botAsked: string[]; botCandidates: string[]; pending?: 'player' | 'bot'; result: 'win' | 'loss' | 'draw' | null };
export default function Game({ categories }: { categories: Category[] }) {
  const { t, path, navigate } = useApp();
  const query = new URLSearchParams(path.split('?')[1]); const roomId = query.get('room'); const deck = query.get('deck');
  if (!roomId && !deck) return <><PageHeading eyebrow="LET’S PLAY" title={t('В какой мир отправимся?', 'Which world is calling?')} text={t('Выбери колоду для тренировки или создай онлайн-комнату.', 'Pick a deck to practice or create an online room.')}><button className="button primary" onClick={() => navigate('/servers')}><Users size={18}/>{t('Играть с другом','Play with a friend')}</button></PageHeading><div className="deck-grid play-decks">{categories.map((category, index) => <DeckCard key={category.id} category={category} index={index} onClick={() => navigate(`/play?deck=${category.id}`)}/>)}</div><div className="practice-info"><Target/><div><h3>{t('Тренировка без ожидания','Practice without the wait')}</h3><p>{t('Бот отвечает на вопросы о внешности и пытается угадать твоего персонажа. Заверши тренировку, чтобы зажечь ежедневный огонёк.', 'The bot answers questions about appearance and tries to guess your character. Finish practice to light your daily streak.')}</p></div></div></>;
  if (deck && !categories.some(c => c.id === deck)) return <CustomPractice deckId={deck}/>;
  return <Match key={roomId || deck} categories={categories} roomId={roomId} deckId={deck}/>;
}

function CustomPractice({ deckId }: { deckId: string }) {
  const {t, online, navigate} = useApp();
  const [deck, setDeck] = useState<Category | null>(null); const [failed, setFailed] = useState(false);
  useEffect(()=>{if(!online)return;let active=true;setFailed(false);setDeck(null);rpc<DeckRecord>('get_deck',{p_id:deckId}).then(value=>{if(active)setDeck(value.data);}).catch(()=>{if(active)setFailed(true);});return()=>{active=false;};},[deckId,online]);
  if(!deck)return <div className="empty-state"><h2>{failed ? t('Колода недоступна','Deck unavailable') : t('Загружаем колоду…','Loading deck…')}</h2><button className="button" onClick={()=>navigate('/decks')}>{t('К колодам','Back to decks')}</button></div>;
  return <Match key={deckId} categories={[deck]} roomId={null} deckId={deckId}/>;
}

function Match({ categories, roomId, deckId }: { categories: Category[]; roomId: string | null; deckId: string | null }) {
  const { t, lang, profile, online, navigate, toast, refresh } = useApp();
  const [view, setView] = useState<GameView | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [roomDeck,setRoomDeck] = useState<Category | null>(null);
  const turnSnapshot = useRef<string | null>(null);
  const category = roomDeck || categories.find(c => c.id === (view?.room.category || deckId)) || categories[0];
  const storageKey = `match:${roomId || deckId}`;
  const {closed, changeClosed, flushBoard} = useBoard(roomId, storageKey, view, () => toast(t('Не удалось сохранить поле. Проверь подключение.', 'Could not save the board. Check your connection.')));
  const [opponentBoard,setOpponentBoard] = useState(false); const [opponentOpen,setOpponentOpen] = useState(false);
  const streakInFlight = useRef(false);
  const [practice, setPractice] = useState<Practice | null>(() => roomId ? null : read(`practice:${deckId}`, null));
  const [thinking, setThinking] = useState(false); const [secretVisible, setSecretVisible] = useState(true); const [guessMode, setGuessMode] = useState(false);
  const [guess, setGuess] = useState<Character | null>(null); const [leaving, setLeaving] = useState(false); const [search, setSearch] = useState(''); const [message, setMessage] = useState('');
  const [voiceState, setVoiceState] = useState('off'); const [muted, setMuted] = useState(false); const [chatOpen, setChatOpen] = useState(false);
  const [reactionOpen,setReactionOpen] = useState(false);
  const [reselect, setReselect] = useState(false);
  const [mobileSecret,setMobileSecret] = useState(false); const chatInitialized = useRef(false);
  const [incoming, setIncoming] = useState<Message | null>(null); const [unread, setUnread] = useState(0);
  const chatScroll = useRef<HTMLDivElement>(null);
  const voice = useRef<VoiceChat | null>(null); const handledResult = useRef(false); const botTimer = useRef<ReturnType<typeof setTimeout> | null>(null); const lastMessage = useRef('');
  const secretId = roomId ? view?.secret : practice?.secret;
  const secret = category.characters.find(c => c.id === secretId);
  const result = roomId ? view?.room.status === 'finished' ? view.room.outcome === 'draw' ? 'draw' : view.room.winner_id === profile.id ? 'win' : view.room.winner_id ? 'loss' : 'closed' : null : practice?.result;
  const canChangeSecret = !!roomId && !!view && ['waiting', 'selecting'].includes(view.room.status);
  const selecting = !result && (!secretId || (reselect && canChangeSecret));
  const isPlaying = roomId ? view?.room.status === 'playing' : !!practice && !practice.result;
  const myTurn = roomId ? view?.room.turn_id === profile.id : !thinking;
  const lastChance = roomId ? !!view?.room.pending_winner && view.room.pending_winner !== profile.id : practice?.pending === 'bot';
  const waitingForFinal = roomId ? view?.room.pending_winner === profile.id : practice?.pending === 'player';
  const messages = roomId ? view?.messages || [] : practice?.messages || [];
  const name = (c: Character) => t(c.name,c.nameEn);
  const opponent = roomId ? view?.room.host_id === profile.id ? view.room.guest_name : view?.room.host_name : t('Бот Шерлок','Sherlock Bot');
  const opponentId = view?.room.host_id === profile.id ? view.room.guest_id : view?.room.host_id;
  const opponentProfile = opponentId ? view?.players?.[opponentId] : undefined;
  const ratingChange = view?.room.rating_changes?.[profile.id];
  const load = async () => { if (!roomId) return; try { setView(await getGame(roomId)); setError(''); } catch { setError(t('Не удалось загрузить матч. Проверь подключение и доступ к комнате.', 'Could not load this match. Check your connection and room access.')); } };
  useEffect(()=>{
    if(!roomId || !online || !supabase)return;
    const connection=crypto.randomUUID();
    const update=(active:boolean)=>rpc('room_presence',{p_room:roomId,p_connection:connection,p_online:active}).catch(()=>{});
    void update(true);const timer=setInterval(()=>void update(true),15000);
    const leave=()=>{void update(false);};window.addEventListener('pagehide',leave);
    return()=>{clearInterval(timer);window.removeEventListener('pagehide',leave);leave();};
  },[roomId,online]);
  useEffect(() => {
    if (!roomId || !online) return;
    let active=true; let loading=false;
    const loadDeck=async()=>{if(loading)return;loading=true;try{const pack=await rpc<Category>('get_room_deck',{p_room:roomId});if(active){setRoomDeck(pack);clearInterval(timer);}}catch{if(active)setError(t('Не удалось загрузить колоду. Повторяем…','Could not load deck. Retrying…'));}finally{loading=false;}};
    const timer=setInterval(()=>void loadDeck(),4000);void loadDeck();
    return()=>{active=false;clearInterval(timer);};
  },[roomId,online]);
  useEffect(() => {
    if (roomId && (!view || !roomDeck)) return;
    const snapshot=roomId ? `${view?.room.status}:${view?.room.turn_id}:${view?.room.pending_winner || ''}` : `${!!practice}:${thinking}:${practice?.pending || ''}:${practice?.result || ''}`;
    const previous=turnSnapshot.current; turnSnapshot.current=snapshot;
    if (!previous || previous===snapshot || !isPlaying) return;
    sound('turn');
    toast(lastChance ? t('Последний шанс! Угадай персонажа, чтобы сыграть вничью.','Last chance! Guess correctly to earn a draw.') : waitingForFinal ? t('Ты угадал! У соперника последний ответный шанс.','Correct! Your opponent has one final chance.') : myTurn ? t('Твой ход!','Your turn!') : t('Ход передан сопернику','Turn passed to your opponent'));
  },[roomDeck,view?.room.status,view?.room.turn_id,view?.room.pending_winner,thinking,practice?.secret,practice?.pending,practice?.result]);
  useEffect(() => {
    if (!roomId || !online) return;
    let active = true; let inFlight = false; let local: WebSocket | null = null;
    const sync = async () => { if (inFlight) return; if (!supabase && (!local || local.readyState === WebSocket.CLOSED)) local = localSocket(roomId, 'watch', () => void sync()); inFlight = true; try { const next = await getGame(roomId); if (active) { setView(next); setError(''); } } catch { if (active) setError(t('Соединение прервано. Переподключаемся…','Connection lost. Reconnecting…')); } finally { inFlight = false; } };
    void sync(); const timer = setInterval(() => void sync(), 2500);
    const channel = supabase?.channel(`game:${roomId}:${profile.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, () => void sync()).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_messages', filter: `room_id=eq.${roomId}` }, () => void sync()).subscribe();
    return () => { active = false; clearInterval(timer); if (channel && supabase) void supabase.removeChannel(channel); local?.close(); };
  }, [roomId, online, profile.id]);
  useEffect(() => { if (!roomId) write(`practice:${deckId}`, practice); }, [practice,roomId,deckId]);
  useEffect(() => () => { voice.current?.stop(); if (botTimer.current) clearTimeout(botTimer.current); }, []);
  useEffect(() => {
    if (roomId && (!view || !roomDeck)) return;
    const initial = !chatInitialized.current; chatInitialized.current = true;
    const latest = messages.at(-1);
    if (!latest || latest.id === lastMessage.current) return;
    lastMessage.current = latest.id;
    const chat = chatScroll.current;
    if (chat && (initial || latest.sender_id === profile.id || chat.scrollHeight - chat.scrollTop - chat.clientHeight < 100)) chat.scrollTop = chat.scrollHeight;
    if (!initial && latest.sender_id !== profile.id) {
      sound('message');
      if (window.matchMedia('(max-width: 800px)').matches && !chatOpen) { setIncoming(latest); setUnread(count => count + 1); }
    }
  }, [messages,profile.id,chatOpen,roomDeck]);
  useEffect(() => { if (!incoming) return; const timer = setTimeout(() => setIncoming(null),7000); return () => clearTimeout(timer); },[incoming]);
  useEffect(() => {
    if (!chatOpen) return;
    setIncoming(null); setUnread(0);
    if (chatScroll.current) chatScroll.current.scrollTop = chatScroll.current.scrollHeight;
    const previous = document.body.style.overflow;
    if (window.matchMedia('(max-width: 800px)').matches) document.body.style.overflow = 'hidden';
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setChatOpen(false); };
    window.addEventListener('keydown',close);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown',close); };
  },[chatOpen]);
  useEffect(() => {
    if (!result || handledResult.current) return;
    handledResult.current = true; sound(result === 'win' ? 'win' : result === 'draw' ? 'draw' : 'wrong');
    if (roomId) void refresh();
  }, [result,roomId,refresh]);
  const botMessage = (body: string, sender = 'bot'): Message => ({ id: crypto.randomUUID(), sender_id: sender, username: sender === 'bot' ? t('Шерлок','Sherlock') : profile.username, body, created_at: new Date().toISOString() });
  const finishPractice = (value: Practice, outcome: 'win' | 'loss' | 'draw') => {
    const stats = read('practice-stats', { wins: 0, draws: 0, games: 0 }); write('practice-stats', { wins: stats.wins + (outcome === 'win' ? 1 : 0), draws: (stats.draws || 0) + (outcome === 'draw' ? 1 : 0), games: stats.games + 1 });
    setPractice({ ...value, result: outcome });
  };
  const choose = async (c: Character) => {
    if (busy) return;
    if (roomId) { setBusy(true); try { await rpc('select_secret', { p_room: roomId, p_character: c.id }); setReselect(false); setSecretVisible(true); setSearch(''); await load(); } catch { toast(t('Не удалось выбрать персонажа','Could not select character')); } finally { setBusy(false); } }
    else { setPractice({ secret: c.id, target: randomCharacter(category.characters).id, messages: [botMessage(t('Я загадал персонажа. Задавай вопросы о внешности кнопками ниже. После вопроса закрывай неподходящие карты!', 'I picked a character. Ask about their appearance with the buttons below, then close the cards that don’t match!'))], asked: [], botAsked: [], botCandidates: category.characters.map(ch => ch.id), result: null }); setSecretVisible(true); }
  };
  useEffect(() => {
    if (roomId || !online || !practice || practice.streakRecorded || streakInFlight.current) return;
    if (!practice.streakTicket && practice.result) return;
    if (practice.streakTicket && !practice.result) return;
    streakInFlight.current = true;
    const target = practice.target;
    const task = practice.result ? rpc('finish_practice_streak', {p_ticket: practice.streakTicket, p_outcome: practice.result}) : rpc<string>('start_practice_streak', {p_category: deckId});
    void task.then(value => { setPractice(previous => previous?.target === target ? {...previous, ...(practice.result ? {streakRecorded:true} : {streakTicket:value as string})} : previous); if (practice.result) void refresh(); }).catch(() => toast(t('Не удалось обновить огонёк. Проверь подключение.', 'Could not update your streak. Check your connection.'))).finally(() => { streakInFlight.current = false; });
  }, [roomId,online,practice?.target,practice?.result,practice?.streakTicket,practice?.streakRecorded]);
  const clickCard = (c: Character) => { if (result || selecting) return; if ((guessMode || lastChance) && isPlaying && myTurn) { setGuess(c); return; } sound('flip'); changeClosed(previous => toggleCard(previous,c.id)); };
  const botTurn = (next: Practice) => {
    setThinking(true);
    botTimer.current = setTimeout(() => {
      const myCharacter = category.characters.find(c => c.id === next.secret)!;
      const available = questions.filter(q => !next.botAsked.includes(q.key));
      if (next.pending === 'player' || next.botCandidates.length <= 2 || !available.length) {
        const candidate = next.botCandidates[Math.floor(Math.random() * next.botCandidates.length)]; const guessed = category.characters.find(c => c.id === candidate)!;
        const final = { ...next, messages: [...next.messages, botMessage(t(`Моя догадка: ${name(guessed)}!`, `My guess: ${name(guessed)}!`))] };
        if (next.pending === 'player') finishPractice(final,candidate === next.secret ? 'draw' : 'win');
        else if (candidate === next.secret) setPractice({...final,pending:'bot',messages:[...final.messages,botMessage(t('Я угадал! У тебя одна догадка, чтобы сыграть вничью.','I guessed correctly! You have one guess to earn a draw.'))]});
        else setPractice({ ...final, botCandidates: next.botCandidates.filter(id => id !== candidate), messages: [...final.messages,botMessage(t('Не угадал. Закрываю карточку. Твой ход!','Wrong guess. Closing that card. Your turn!'))] });
      } else {
        const q = [...available].sort((a,b) => Math.abs(next.botCandidates.filter(id => category.characters.find(c => c.id === id)!.traits.includes(a.key)).length - next.botCandidates.length / 2) - Math.abs(next.botCandidates.filter(id => category.characters.find(c => c.id === id)!.traits.includes(b.key)).length - next.botCandidates.length / 2))[0];
        const answer = myCharacter.traits.includes(q.key);
        setPractice({ ...next, botAsked: [...next.botAsked,q.key], botCandidates: next.botCandidates.filter(id => category.characters.find(c => c.id === id)!.traits.includes(q.key) === answer), messages: [...next.messages,botMessage(t(`Мой вопрос: ${q.ru} Ответ: ${answer ? 'да' : 'нет'}. Твой ход!`, `My question: ${q.en} Answer: ${answer ? 'yes' : 'no'}. Your turn!`))] });
      }
      setThinking(false);
    }, 1300);
  };
  useEffect(()=>{if(!roomId && practice?.pending === 'player' && !practice.result && !thinking)botTurn(practice);},[practice?.pending]);
  const ask = async (question: typeof questions[number]) => {
    if (roomId) { await send(t(question.ru,question.en)); return; }
    if (!practice || thinking || result || practice.pending) return;
    const target = category.characters.find(c => c.id === practice.target)!; const yes = target.traits.includes(question.key);
    const next = { ...practice, asked: [...practice.asked,question.key], messages: [...practice.messages,botMessage(t(question.ru,question.en),profile.id),botMessage(yes ? t('Да!','Yes!') : t('Нет.','No.'))] };
    setPractice(next); botTurn(next);
  };
  const send = async (body: string) => {
    if (!body.trim() || busy) return;
    if (!roomId) { toast(t('В тренировке используй вопросы под игровым полем','Use the question buttons below the board in practice')); return; }
    setBusy(true); try { await rpc('send_message', { p_room: roomId, p_body: body.trim() }); setMessage(''); setReactionOpen(false); await load(); } catch { toast(t('Сообщение не отправлено. Подожди секунду и повтори.','Message not sent. Wait a moment and try again.')); } finally { setBusy(false); }
  };
  const submitGuess = async () => {
    if (!guess || busy) return; setBusy(true);
    try {
      let correct = false; let ended = false;
      if (roomId) { await flushBoard(); const answer = await rpc<{correct:boolean;winner_id:string|null;draw?:boolean}>('guess_character', { p_room: roomId, p_character: guess.id }); correct = answer.correct; ended = !!answer.winner_id || !!answer.draw; await load(); }
      else if (practice) {
        correct = practice.target === guess.id;
        if (practice.pending === 'bot') { finishPractice(practice,correct ? 'draw' : 'loss'); ended = true; }
        else if (correct) { const next:Practice={...practice,pending:'player',messages:[...practice.messages,botMessage(t('Верно! Теперь моя последняя догадка.','Correct! Now I get one final guess.'))]}; setPractice(next); botTurn(next); }
        else { const next = { ...practice, messages: [...practice.messages,botMessage(t(`Моя догадка: ${name(guess)}.`, `My guess: ${name(guess)}.`),profile.id),botMessage(t('Нет, это другой персонаж. Теперь мой ход!','No, it is someone else. My turn!'))] }; setPractice(next); botTurn(next); }
      }
      if (!correct && !ended) { if (!roomId) changeClosed(previous => previous.includes(guess.id) ? previous : [...previous,guess.id]); sound('flip'); toast(t('Не угадал. Карточка закрыта, ход соперника.','Not this time. Card closed, opponent’s turn.')); }
      setGuess(null); setGuessMode(false);
    } catch { toast(t('Ход не принят. Обновляю состояние игры.','Move not accepted. Refreshing the game.')); await load(); } finally { setBusy(false); }
  };
  useEffect(() => { if (view && !view.voice_allowed) { voice.current?.stop(); setVoiceState('off'); } }, [view?.voice_allowed]);
  const startVoice = async () => {
    if (voiceState !== 'off' && voiceState !== 'failed' && voiceState !== 'disconnected') { voice.current?.stop(); setVoiceState('off'); return; }
    if (!roomId || !view?.room.guest_id) { toast(t('Голосовой чат доступен, когда в комнате два игрока','Voice chat is available when both players have joined')); return; }
    if (!view.voice_allowed) { toast(t('Голос доступен только друзьям. Добавьте друг друга во вкладке «Друзья».','Voice is for friends only. Add each other on the Friends page.')); return; }
    voice.current?.stop(); setMuted(false); setVoiceState('connecting'); const instance = new VoiceChat(); voice.current = instance;
    try { await instance.start(roomId, profile.id, view.room.host_id === profile.id, setVoiceState); } catch { instance.stop(); setVoiceState('off'); toast(t('Не удалось включить микрофон. Проверь разрешение браузера и сеть.','Could not enable voice. Check microphone permission and your connection.')); }
  };
  const restart = () => { setPractice(null); changeClosed([]); setGuessMode(false); handledResult.current = false; setSecretVisible(true); setReselect(false); setSearch(''); };
  const leave = async () => { if (roomId) { setBusy(true); try { await rpc('leave_room', { p_room: roomId }); } catch { toast(t('Не удалось выйти. Проверь подключение.','Could not leave. Check your connection.')); setBusy(false); return; } } voice.current?.stop(); navigate(roomId ? '/servers' : '/play'); };
  if (roomId && (!view || !roomDeck)) return <div className="empty-state"><Swords size={36}/><h2>{!online ? t('Нужно подключение к арене','Arena connection required') : t('Открываем комнату…','Opening your room…')}</h2><p>{error || (!online ? t('Проверь подключение в настройках','Check your connection in settings') : t('Загружаем игровое поле','Preparing the board'))}</p><button className="button" onClick={() => navigate('/servers')}>{t('К комнатам','Back to rooms')}</button></div>;
  return <div className="game-page"><div className="game-heading"><button className="icon-button" onClick={() => setLeaving(true)} aria-label={t('Выйти из игры','Leave game')}><ArrowLeft/></button><div><span className="eyebrow">{roomId ? view?.room.is_ranked ? t('РЕЙТИНГОВАЯ · ELO','RANKED · ELO') : t('ДРУЖЕСКАЯ · БЕЗ ELO','FRIENDLY · NO ELO') : t('ТРЕНИРОВКА С БОТОМ','BOT PRACTICE')}</span><h1>{t(category.title,category.titleEn)}</h1></div>{roomId && <button className="room-code" onClick={async () => { try { await navigator.clipboard.writeText(view!.room.code); toast(t('Код скопирован','Code copied')); } catch { toast(view!.room.code); } }}>{view!.room.code}<Copy size={15}/></button>}<button className="icon-button mobile-chat-toggle" onClick={() => setChatOpen(!chatOpen)} aria-label={t('Чат','Chat')}><MessageCircle/></button></div>
    {error && <div className="connection-error" role="alert">{error}</div>}
    {result && <div className={`result-banner ${result === 'win' ? 'won' : ''}`}><Trophy size={38}/><div><h2>{result === 'win' ? t('Дело раскрыто. Победа!','Case closed. You win!') : result === 'draw' ? t('Ничья. Оба раскрыли секрет!','A draw. Both secrets solved!') : result === 'closed' ? t('Комната закрыта','Room closed') : t('В этот раз — соперник','This round goes to your opponent')}</h2><p>{roomId ? t('Результат матча сохранён. Баланс обновлён в профиле.','Match result saved. Your profile balance is up to date.') : t(`Загаданный персонаж: ${name(category.characters.find(c => c.id === practice!.target)!)}.`, `The secret character was ${name(category.characters.find(c => c.id === practice!.target)!)}.`)}</p></div><button className="button primary" onClick={() => roomId ? navigate('/servers') : restart()}>{t('Ещё раунд','Play again')}<ArrowRight size={17}/></button></div>}
    {result && roomId && <div className="match-rating-result">{ratingChange !== undefined ? <><span>♜</span><strong>{ratingChange >= 0 ? '+' : ''}{ratingChange} Elo</strong><span>{t('Рейтинг обновлён','Rating updated')}</span></> : <span>{view?.room.is_ranked ? t('Короткий матч — рейтинг не меняется','Short match — rating unchanged') : t('Дружеская игра — Elo не меняется','Friendly match — Elo unchanged')}</span>}</div>}{roomId && <MatchTools state={voiceState} muted={muted} hasOpponent={!!opponentId} voiceAllowed={!!view?.voice_allowed} onConnect={() => void startVoice()} onMute={() => { voice.current?.mute(!muted); setMuted(!muted); }} onResume={() => voice.current?.resume()} onBoard={() => setOpponentBoard(true)}/>}<div className="match-layout"><section className="board-panel"><div className="match-status"><div className="player-mini"><Avatar name={profile.username} frame={profile.frame} src={profile.avatar}/><span>{profile.username}<StaffBadge value={profile.staff_badge}/><small>{t(titleById(profile.title).ru,titleById(profile.title).en)} · {profile.rating ?? 1000} Elo</small></span></div><button className="versus versus-history" disabled={!opponentId} onClick={()=>navigate(`/profile?opponent=${opponentId}`)} aria-label={t('Личные встречи','Head-to-head')}>VS</button><div className="player-mini opponent"><span>{opponent || t('Ожидаем друга…','Waiting for a friend…')}<StaffBadge value={opponentProfile?.staff_badge}/><small>{thinking ? t('Думает…','Thinking…') : roomId ? view?.room.guest_id ? `${opponentProfile?.rating ?? 1000} Elo · ${t(titleById(opponentProfile?.title || 'rookie').ru,titleById(opponentProfile?.title || 'rookie').en)}` : t('Отправь код комнаты','Share your room code') : t('Бот-соперник','Bot opponent')}</small></span>{roomId ? <button className="opponent-avatar-button" disabled={!opponentId} onClick={() => setOpponentOpen(true)} aria-label={t('Профиль соперника','Opponent profile')}><Avatar name={opponent || '?'} src={opponentProfile?.avatar} frame={opponentProfile?.frame}/></button> : <Avatar name={opponent || '?'} src={opponentProfile?.avatar} frame={opponentProfile?.frame}/>}</div></div>
      <div className={`turn-banner ${guessMode ? 'guess-active' : ''}`}><span className="status-dot"/>{result ? t('Раунд завершён','Round complete') : selecting ? t('Выбери секретного персонажа на поле','Choose your secret character on the board') : roomId && !isPlaying ? t('Ждём, пока соперник выберет персонажа','Waiting for your opponent to choose a secret') : lastChance ? t('Последний шанс: нажми на персонажа соперника. Верный ответ — ничья.', 'Final chance: tap your opponent’s character. A correct answer earns a draw.') : waitingForFinal ? t('Ты угадал! Ждём последнюю догадку соперника.', 'Correct! Waiting for your opponent’s final guess.') : guessMode ? t('Кто загаданный персонаж? Нажми на карточку.','Who is the secret character? Select a card.') : myTurn ? t('Твой ход. Хорошие вопросы ведут к победе.','Your turn. Great questions lead to victory.') : t('Ход соперника. Можно закрывать карточки.','Opponent’s turn. You can still close cards.')}</div>
      {selecting ? <SecretSelection category={category} busy={busy} current={secretId || undefined} onConfirm={character => void choose(character)} onCancel={secret ? () => setReselect(false) : undefined}/> : <>
      <div className="board-toolbar"><span><strong>{category.characters.length - closed.length}</strong> / {category.characters.length} {t('на поле','remaining')}</span><div><div className="board-search"><Search size={15}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder={t('Найти персонажа','Find a character')} aria-label={t('Найти персонажа','Find a character')}/></div><button className="icon-button" disabled={!!result || !isPlaying} onClick={() => { changeClosed([]); sound('flip'); }} aria-label={t('Открыть все карточки','Reset all cards')}><RotateCcw size={16}/></button></div></div>
      <div className="character-grid">{category.characters.filter(c => `${c.name} ${c.nameEn}`.toLowerCase().includes(search.toLowerCase())).map(c => <button key={c.id} className={`character-card ${closed.includes(c.id) ? 'closed' : ''}`} onClick={() => clickCard(c)} disabled={busy || !!result} aria-label={`${name(c)}${closed.includes(c.id) ? t(', исключён', ', eliminated') : ''}`} aria-pressed={closed.includes(c.id)}><div className="character-image"><img src={c.img} alt="" loading="lazy" width="360" height="440"/>{closed.includes(c.id) && <span className="closed-mark"><X size={24}/></span>}</div><span className="character-name">{name(c)}</span></button>)}</div>
      {!category.characters.some(c => `${c.name} ${c.nameEn}`.toLowerCase().includes(search.toLowerCase())) && <p className="empty-search">{t('Таких персонажей нет','No characters found')}</p>}
      <div className="board-actions"><button className={`button ${guessMode ? 'danger' : 'primary'}`} disabled={!isPlaying || !myTurn || busy || !!result} onClick={() => setGuessMode(!guessMode)}><Target size={18}/>{lastChance ? t('Последний шанс — выбери карту','Final chance — select a card') : guessMode ? t('Отменить догадку','Cancel guess') : t('Я знаю, кто это!','I know who it is!')}</button>{roomId && <button className="button" disabled={!isPlaying || !myTurn || busy || !!result || lastChance} onClick={async () => { setBusy(true); try { await rpc('pass_turn', { p_room: roomId }); await load(); } catch { toast(t('Не удалось передать ход','Could not pass turn')); } finally { setBusy(false); } }}>{t('Передать ход','Pass turn')}<ArrowRight size={16}/></button>}<span className="board-tip">{t('Нажми на карточку, чтобы исключить','Click a card to eliminate')}</span></div>
      {!result && <div className="question-section"><span className="eyebrow">{t('ХОРОШИЙ ВОПРОС — ПОЛДЕЛА','A GOOD QUESTION IS HALF THE BATTLE')}</span><div className="question-chips">{questions.map(q => <button key={q.key} disabled={!isPlaying || !myTurn || busy || lastChance || waitingForFinal || (!roomId && practice?.asked.includes(q.key))} onClick={() => void ask(q)}>{t(q.ru,q.en)}</button>)}</div></div>}
    </>}
    </section><aside className={`game-rail ${chatOpen ? 'chat-open' : ''}`} role={chatOpen ? 'dialog' : undefined} aria-modal={chatOpen || undefined} aria-label={t('Чат матча','Match chat')}><button className="chat-sheet-close icon-button" onClick={() => setChatOpen(false)} aria-label={t('Закрыть чат','Close chat')}><X/></button><section className="secret-panel"><div className="section-heading"><span className="eyebrow">{t('ТВОЙ СЕКРЕТ','YOUR SECRET')}</span><button className="icon-button" onClick={() => setSecretVisible(!secretVisible)} aria-label={secretVisible ? t('Скрыть персонажа','Hide character') : t('Показать персонажа','Show character')}>{secretVisible ? <Eye size={17}/> : <EyeOff size={17}/>}</button></div>{secret ? <div className={`secret-card ${secretVisible ? '' : 'veiled'}`}><img src={secret.img} alt={secretVisible ? name(secret) : ''}/><div><strong>{secretVisible ? name(secret) : '???'}</strong><small>{t('Соперник не видит эту карту','Your opponent cannot see this')}</small></div>{!secretVisible && <span className="secret-veil">?</span>}</div> : <div className="secret-empty"><span>?</span><p>{t('Выбери персонажа на поле','Choose a character on the board')}</p></div>}{secret && canChangeSecret && <button className="button small full" onClick={() => setReselect(true)}>{t('Выбрать другого', 'Choose another')}</button>}</section>
    <section className="chat-panel"><div className="chat-heading"><h3><MessageCircle size={17}/>{t('Чат матча','Match chat')}</h3><span className="status-dot"/></div><div ref={chatScroll} className="chat-messages" aria-live="polite" role="log">{!messages.length && <p className="chat-welcome">{t('Поздоровайся и задай первый вопрос. Вопросы должны допускать ответ «да» или «нет».','Say hello and ask your first question. Questions should have a yes or no answer.')}</p>}{messages.map(m => <div className={`chat-message ${m.sender_id === profile.id ? 'mine' : ''}`} key={m.id}><div><strong>{m.sender_id === profile.id ? t('Ты','You') : m.username}</strong><time>{new Date(m.created_at).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}</time></div><p>{chatBody(m.body)}</p></div>)}</div>{roomId ? <><div className="chat-reactions">{['👍','👀','😂'].map(emoji => <button disabled={busy} key={emoji} onClick={() => void send(emoji)} aria-label={emoji}>{emoji}</button>)}<button className="reaction-picker-toggle" aria-label={t('Все реакции','All reactions')} aria-expanded={reactionOpen} onClick={() => setReactionOpen(!reactionOpen)}><Smile size={17}/></button><button className="quick-answer" disabled={busy} onClick={() => void send(t('Да','Yes'))}>{t('Да','Yes')}</button><button className="quick-answer" disabled={busy} onClick={() => void send(t('Нет','No'))}>{t('Нет','No')}</button></div>{reactionOpen && <div className="reaction-picker"><span>{t('ТВОИ РЕАКЦИИ','YOUR REACTIONS')}</span><div>{['👍','👀','😂','🤝','😎','😭','😅','🤔','👏','🙃','🎉','💪',...shopItems.filter(i=>i.type==='emoji' && profile.owned.includes(i.id)).map(i=>i.emoji!)].map(emoji=><button disabled={busy} key={emoji} onClick={()=>void send(emoji)} aria-label={emoji}>{emoji}</button>)}</div><button className="reaction-shop-link" onClick={()=>navigate('/shop')}>{t('Больше реакций в магазине','More reactions in the shop')} ↗</button></div>}<form className="chat-input" onSubmit={event => { event.preventDefault(); void send(message); }}><input aria-label={t('Сообщение','Message')} value={message} onChange={event => setMessage(event.target.value)} maxLength={300} placeholder={t('Твой вопрос…','Your question…')}/><button className="icon-button" disabled={busy || !message.trim()} aria-label={t('Отправить','Send')}><Send size={18}/></button></form></> : <div className="bot-chat-note">{t('Выбирай вопросы под игровым полем','Choose questions below the board')}</div>}</section>

    <button className="leave-button" onClick={() => setLeaving(true)}><Flag size={15}/>{t('Покинуть игру','Leave game')}</button></aside></div>
    {secret && !selecting && <button className="mobile-secret-button" onClick={()=>setMobileSecret(true)} aria-label={t(`Мой персонаж: ${name(secret)}`, `My character: ${name(secret)}`)}><img src={secret.img} alt=""/><span><small>{t('МОЙ ПЕРСОНАЖ','MY CHARACTER')}</small><strong>{name(secret)}</strong></span><Eye size={17}/></button>}
    {opponentOpen && opponentId && <Modal title={t('Игрок за столом','Player at your table')} onClose={() => setOpponentOpen(false)}><div className="opponent-profile"><Avatar name={opponent || '?'} src={opponentProfile?.avatar} frame={opponentProfile?.frame} large/><h3>{opponent}<StaffBadge value={opponentProfile?.staff_badge}/></h3><p>{opponentProfile?.rating ?? 1000} Elo</p></div><p className="muted">{t('Добавьте друг друга в друзья, чтобы общаться голосом и приглашать на новые игры.','Become friends to use voice chat and invite each other to more games.')}</p><button className="button primary full" disabled={busy || view?.friendship === 'friends' || view?.friendship === 'outgoing'} onClick={async () => { setBusy(true); try { if (view?.friendship === 'incoming') await rpc('respond_friend',{p_user:opponentId,p_accept:true}); else await rpc('request_match_friend',{p_room:roomId}); await load(); toast(view?.friendship === 'incoming' ? t('Теперь вы друзья! Голосовой чат доступен.','You are friends! Voice chat is available.') : t('Заявка отправлена','Friend request sent')); } catch { toast(t('Не удалось отправить заявку. Попробуй позже.','Could not send the request. Try again later.')); } finally { setBusy(false); } }}>{view?.friendship === 'friends' ? t('Вы друзья','You are friends') : view?.friendship === 'outgoing' ? t('Заявка отправлена','Request sent') : view?.friendship === 'incoming' ? t('Принять заявку','Accept request') : t('Добавить в друзья','Add friend')}</button></Modal>}
    {opponentBoard && <OpponentBoard category={category} closed={view?.opponent_closed || []} opponent={opponent || ''} onClose={() => setOpponentBoard(false)}/>}
    {mobileSecret && secret && <Modal title={t('Твой секрет','Your secret')} onClose={()=>setMobileSecret(false)}><div className="guess-preview"><img src={secret.img} alt={name(secret)}/><h3>{name(secret)}</h3></div><p className="muted">{t('Соперник не видит эту карту','Your opponent cannot see this card')}</p>{canChangeSecret ? <button className="button primary full" onClick={() => { setMobileSecret(false); setReselect(true); window.scrollTo({top: 0, behavior: 'smooth'}); }}>{t('Выбрать другого', 'Choose another')}</button> : <p className="muted">{t('Персонаж закреплён до конца раунда.', 'Your character is locked until the end of the round.')}</p>}</Modal>}
    <button className="chat-fab" onClick={() => setChatOpen(true)} aria-label={t('Открыть чат','Open chat')}><MessageCircle size={22}/>{unread > 0 && <span>{unread > 9 ? '9+' : unread}</span>}</button>
    {chatOpen && <button className="chat-sheet-overlay" onClick={() => setChatOpen(false)} aria-label={t('Закрыть чат','Close chat')}/>}
    {incoming && <div className="message-notice" role="status"><button className="message-notice-content" onClick={() => setChatOpen(true)}><span className="message-notice-icon"><MessageCircle size={20}/></span><span><strong>{incoming.username}<small>{t('Чат матча','Match chat')}</small></strong><span className="message-notice-body">{incoming.body}</span></span></button><button className="icon-button" onClick={() => setIncoming(null)} aria-label={t('Скрыть уведомление','Dismiss notification')}><X size={17}/></button></div>}
    {guess && <Modal title={t('Последнее слово?','Your final answer?')} onClose={() => setGuess(null)}><div className="guess-preview"><img src={guess.img} alt={name(guess)}/><h3>{name(guess)}</h3></div><p className="muted">{lastChance ? t('Это последняя догадка: верный ответ — ничья, ошибка — поражение.', 'This is your final guess: a correct answer earns a draw, a wrong answer means a loss.') : t('Если угадаешь, у соперника будет одна догадка для ничьей. Ошибка закрывает карту и передаёт ход.', 'If you guess correctly, your opponent gets one guess to draw. A wrong guess closes the card and passes the turn.')}</p><button className="button primary full" disabled={busy} onClick={() => void submitGuess()}><Target size={17}/>{t('Это мой ответ','That’s my answer')}</button></Modal>}
    {leaving && <Modal title={t('Покинуть матч?','Leave this match?')} onClose={() => setLeaving(false)}><p className="muted">{roomId ? t('Текущая онлайн-игра завершится. За выход монеты не начисляются.','The online match will end. Forfeits do not award coins.') : t('Тренировка сохранится. Можно вернуться позже.','Your practice is saved. You can return later.')}</p><div className="modal-actions"><button className="button" onClick={() => setLeaving(false)}>{t('Остаться','Stay')}</button><button className="button danger" disabled={busy} onClick={() => void leave()}>{t('Выйти','Leave')}</button></div></Modal>}
  </div>;
}
