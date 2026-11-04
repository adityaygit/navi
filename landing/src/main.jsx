import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// Interim for narrow screens until the mobile layout exists: scale the 1186px desktop layout to fit.
const DESIGN_WIDTH = 1186;
function fit() {
  const w = document.documentElement.clientWidth || window.innerWidth;
  document.documentElement.style.zoom = w < DESIGN_WIDTH ? String(w / DESIGN_WIDTH) : '';
}
fit();
window.addEventListener('resize', fit);

createRoot(document.getElementById('root')).render(<App />);
