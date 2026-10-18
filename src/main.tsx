import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { trackVisit } from './shared/visit';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />);
trackVisit();
