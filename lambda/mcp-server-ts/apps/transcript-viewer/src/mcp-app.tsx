import { createRoot } from 'react-dom/client';
import '@shared/styles/global.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
