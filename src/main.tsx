import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  let reloadedForSwUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadedForSwUpdate) return;
    reloadedForSwUpdate = true;
    window.location.reload();
  });
  const checkForSwUpdate = () => {
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => {
        regs.forEach((reg) => {
          reg.update().catch(() => {});
        });
      })
      .catch(() => {});
  };
  window.addEventListener('load', checkForSwUpdate);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkForSwUpdate();
    }
  });
}

createRoot(document.getElementById('root')!).render(<App />);
