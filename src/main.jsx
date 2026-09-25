import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import App from './components/App.jsx';
import { applyTheme } from './theme.js';

applyTheme(); // before the first paint, so every colour read from CSS variables is right

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
