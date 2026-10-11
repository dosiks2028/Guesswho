import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { AppProvider, useApp } from './context';
import { Layout } from './components/Layout';
import catalog from './data/catalog.json';
import type { Category } from './types';
import { read } from './lib/storage';
import './styles.css';
import './features.css';
const Home = lazy(() => import('./pages/Home'));
const Decks = lazy(() => import('./pages/Decks'));
const Game = lazy(() => import('./pages/Game'));
const Servers = lazy(() => import('./pages/Servers'));
const Shop = lazy(() => import('./pages/Shop'));
const Profile = lazy(() => import('./pages/Profile'));
const Friends = lazy(() => import('./pages/Friends'));
const Leaderboard = lazy(() => import('./pages/Leaderboard'));
const Settings = lazy(() => import('./pages/Settings'));
const categories = catalog as Category[];
document.documentElement.classList.toggle('reduce-motion', read('reduce-motion', false));
function App() {
  const { path, t, navigate } = useApp(); const route = path.split('?')[0];
  const page = route === '/' ? <Home categories={categories}/> : route === '/play' ? <Game categories={categories}/> : route === '/servers' ? <Servers categories={categories}/> : route === '/decks' ? <Decks/> : route === '/shop' ? <Shop/> : route === '/profile' ? <Profile/> : route === '/friends' ? <Friends categories={categories}/> : route === '/leaderboard' ? <Leaderboard/> : route === '/settings' ? <Settings/> : <div className="empty-state"><h1>404</h1><p>{t('Эта страница пока не раскрыта','This page is still a mystery')}</p><button className="button primary" onClick={() => navigate('/')}>{t('На главную','Back home')}</button></div>;
  return <Layout><Suspense fallback={<div className="loading-state"><span className="brand-mark">?</span><p>{t('Готовим арену…','Preparing the arena…')}</p></div>}>{page}</Suspense></Layout>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><AppProvider><App/></AppProvider></React.StrictMode>);
