import type { Character } from '../types';
export function toggleCard(closed: string[], id: string) { return closed.includes(id) ? closed.filter(item => item !== id) : [...closed, id]; }
export function checkGuess(secret: string, guess: string) { return secret === guess; }
export function randomCharacter(characters: Character[]) { return characters[crypto.getRandomValues(new Uint32Array(1))[0] % characters.length]; }
export const questions = [
  { key: 'male', ru: 'Это мужчина?', en: 'Is your character male?' },
  { key: 'female', ru: 'Это женщина?', en: 'Is your character female?' },
  { key: 'dark', ru: 'У персонажа тёмные волосы?', en: 'Does your character have dark hair?' },
  { key: 'light', ru: 'У персонажа светлые волосы?', en: 'Does your character have light hair?' },
  { key: 'glasses', ru: 'Персонаж носит очки?', en: 'Does your character wear glasses?' },
];
export const shopItems = [
  { id: 'frame-lime', type: 'frame', ru: 'Кислотный неон', en: 'Acid neon', price: 150, color: '#d7fa62', rarity: 'rare' },
  { id: 'frame-violet', type: 'frame', ru: 'Космическая пыль', en: 'Cosmic dust', price: 250, color: '#b399ff', rarity: 'epic' },
  { id: 'frame-gold', type: 'frame', ru: 'Чемпион', en: 'Champion', price: 500, color: '#f6c563', rarity: 'legendary' },
  { id: 'emoji-fire', type: 'emoji', ru: 'На огне', en: 'On fire', price: 100, color: '#f5986e', emoji: '🔥', rarity: 'rare' },
  { id: 'emoji-brain', type: 'emoji', ru: 'Большой мозг', en: 'Big brain', price: 100, color: '#f6a0c4', emoji: '🧠', rarity: 'rare' },
  { id: 'emoji-crown', type: 'emoji', ru: 'Королевский ход', en: 'Royal move', price: 200, color: '#f6c563', emoji: '👑', rarity: 'epic' },
  { id: 'emoji-devil', type: 'emoji', ru: 'Хитрый план', en: 'Evil plan', price: 150, color: '#dcb87c', emoji: '😈', rarity: 'epic' },
  { id: 'emoji-clown', type: 'emoji', ru: 'Цирк уехал', en: 'Clown show', price: 150, color: '#dcb87c', emoji: '🤡', rarity: 'epic' },
  { id: 'emoji-skull', type: 'emoji', ru: 'Умер со смеху', en: 'Dead laughing', price: 150, color: '#dcb87c', emoji: '💀', rarity: 'epic' },
  { id: 'emoji-yawn', type: 'emoji', ru: 'Я уже засыпаю', en: 'Still waiting', price: 100, color: '#dcb87c', emoji: '🥱', rarity: 'rare' },
  { id: 'emoji-salt', type: 'emoji', ru: 'Слишком солёно', en: 'Extra salty', price: 100, color: '#dcb87c', emoji: '🧂', rarity: 'rare' },
  { id: 'emoji-ez', type: 'emoji', ru: 'Без шансов', en: 'Too easy', price: 250, color: '#dcb87c', emoji: 'GG EZ', rarity: 'epic' },
  { id: 'emoji-rage', type: 'emoji', ru: 'Подгорело', en: 'Tilted', price: 120, color: '#dcb87c', emoji: '😤', rarity: 'rare' },
  { id: 'emoji-ice', type: 'emoji', ru: 'Холодный расчёт', en: 'Ice cold', price: 120, color: '#dcb87c', emoji: '🥶', rarity: 'rare' },
  { id: 'emoji-goat', type: 'emoji', ru: 'Легенда', en: 'The GOAT', price: 200, color: '#dcb87c', emoji: '🐐', rarity: 'epic' },
  { id: 'emoji-sus', type: 'emoji', ru: 'Подозрительно', en: 'Sus', price: 100, color: '#dcb87c', emoji: '🤨', rarity: 'rare' },
  { id: 'emoji-cry', type: 'emoji', ru: 'Ну не плачь', en: 'There there', price: 100, color: '#dcb87c', emoji: '🥲', rarity: 'rare' },
  { id: 'emoji-cook', type: 'emoji', ru: 'Дай приготовить', en: 'Let me cook', price: 150, color: '#dcb87c', emoji: '🧑‍🍳', rarity: 'epic' },
  { id: 'emoji-popcorn', type: 'emoji', ru: 'Смотрю шоу', en: 'Enjoying the show', price: 100, color: '#dcb87c', emoji: '🍿', rarity: 'rare' },
  { id: 'emoji-nerd', type: 'emoji', ru: 'Вообще-то…', en: 'Actually…', price: 100, color: '#dcb87c', emoji: '🤓', rarity: 'rare' },
  { id: 'emoji-smirk', type: 'emoji', ru: 'Я всё знаю', en: 'I know', price: 100, color: '#dcb87c', emoji: '😏', rarity: 'rare' },
  { id: 'emoji-bye', type: 'emoji', ru: 'До свидания', en: 'Bye bye', price: 100, color: '#dcb87c', emoji: '👋', rarity: 'rare' },
];
