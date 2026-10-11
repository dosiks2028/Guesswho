import type { Profile } from '../types';
type Title = { id:string; ru:string; en:string; descriptionRu:string; descriptionEn:string; target:number; progress:(p:Profile)=>number; symbol:string };
const category = (p:Profile,id:string) => p.category_wins?.[id] || 0;
const anime = (p:Profile) => category(p,'naruto')+category(p,'attack-on-titan');
export const titles:Title[] = [
  {id:'rookie',ru:'Новичок',en:'Rookie',descriptionRu:'Добро пожаловать за стол',descriptionEn:'Welcome to the table',target:1,progress:()=>1,symbol:'♟'},
  {id:'first-case',ru:'Юный детектив',en:'Young Detective',descriptionRu:'Первая онлайн-победа',descriptionEn:'Your first online victory',target:1,progress:p=>p.wins,symbol:'🔎'},
  {id:'senpai',ru:'Сенпай',en:'Senpai',descriptionRu:'5 побед в аниме-категориях',descriptionEn:'5 wins in anime categories',target:5,progress:anime,symbol:'🌸'},
  {id:'sensei',ru:'Сэнсэй',en:'Sensei',descriptionRu:'15 побед в аниме-категориях',descriptionEn:'15 wins in anime categories',target:15,progress:anime,symbol:'⛩️'},
  {id:'anime-legend',ru:'Легенда аниме',en:'Anime Legend',descriptionRu:'30 побед в аниме-категориях',descriptionEn:'30 wins in anime categories',target:30,progress:anime,symbol:'🐉'},
  {id:'wizard',ru:'Чародей',en:'Wizard',descriptionRu:'5 побед в мире Гарри Поттера',descriptionEn:'5 wins in Harry Potter',target:5,progress:p=>category(p,'harry-potter'),symbol:'🪄'},
  {id:'archmage',ru:'Архимаг',en:'Archmage',descriptionRu:'20 побед в мире Гарри Поттера',descriptionEn:'20 wins in Harry Potter',target:20,progress:p=>category(p,'harry-potter'),symbol:'🔮'},
  {id:'avenger',ru:'Мститель',en:'Avenger',descriptionRu:'5 побед в Marvel',descriptionEn:'5 wins in Marvel',target:5,progress:p=>category(p,'avengers'),symbol:'⚡'},
  {id:'multiverse',ru:'Хранитель мультивселенной',en:'Multiverse Guardian',descriptionRu:'20 побед в Marvel',descriptionEn:'20 wins in Marvel',target:20,progress:p=>category(p,'avengers'),symbol:'🌌'},
  {id:'sherlock',ru:'Шерлок',en:'Sherlock',descriptionRu:'10 онлайн-побед',descriptionEn:'10 online victories',target:10,progress:p=>p.wins,symbol:'🕵️'},
  {id:'mastermind',ru:'Мастер дедукции',en:'Master of Deduction',descriptionRu:'50 онлайн-побед',descriptionEn:'50 online victories',target:50,progress:p=>p.wins,symbol:'♛'},
  {id:'worldwalker',ru:'Покоритель миров',en:'Worldwalker',descriptionRu:'По 5 побед в каждой из 4 категорий',descriptionEn:'5 wins in each of the 4 categories',target:20,progress:p=>['naruto','attack-on-titan','harry-potter','avengers'].reduce((sum,id)=>sum+Math.min(5,category(p,id)),0),symbol:'🧭'},
];
export const titleById = (id:string) => titles.find(title=>title.id===id) || titles[0];
export const ratingTier = (rating:number) => rating>=1800 ? {ru:'Гроссмейстер',en:'Grandmaster',symbol:'♚'} : rating>=1500 ? {ru:'Мастер',en:'Master',symbol:'♛'} : rating>=1200 ? {ru:'Стратег',en:'Strategist',symbol:'♜'} : {ru:'Исследователь',en:'Explorer',symbol:'♞'};
