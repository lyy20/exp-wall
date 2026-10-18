import { createRoot } from 'react-dom/client';
import '../shared/styles/tokens.css';
import App from './App';
import { trackVisit } from '../shared/visit';

createRoot(document.getElementById('root')!).render(<App />);
trackVisit();
