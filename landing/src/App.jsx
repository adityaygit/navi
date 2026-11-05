import React, { useEffect } from 'react';
import { Nav, Footer, useRoute } from './site.jsx';
import { Home } from './Home.jsx';
import { HowItWorks, Features, Privacy, About, Terms } from './pages.jsx';
import { Guides, Guide, GUIDES } from './guides.jsx';

const PAGES = {
  '/': [Home, 'Navi · A calmer way to run your life'],
  '/how-it-works': [HowItWorks, 'How it works · Navi'],
  '/features': [Features, 'Features · Navi'],
  '/guides': [Guides, 'Guides · Navi'],
  '/privacy-and-control': [Privacy, 'Privacy & control · Navi'],
  '/about': [About, 'About · Navi'],
  '/terms': [Terms, 'Terms · Navi'],
};

export default function App() {
  const path = useRoute();
  const guide = path.startsWith('/guides/') ? path.slice('/guides/'.length) : null;
  const g = guide && GUIDES.find((x) => x.slug === guide);
  const [Page, title] = guide ? [() => <Guide slug={guide} />, g ? `${g.title} · Navi` : 'Guides · Navi'] : PAGES[path] || PAGES['/'];
  useEffect(() => { document.title = title; }, [title]);
  return (
    <>
      <Nav path={path} />
      <main key={path}><Page /></main>
      <Footer />
    </>
  );
}
