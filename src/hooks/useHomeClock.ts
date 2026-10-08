import { useEffect, useState } from 'react';
import { getHomeClockDelay } from '../utils/homeClock';

export function useHomeClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timeout);
      if (document.hidden) return;
      const current = new Date();
      setNow(current);
      timeout = setTimeout(update, getHomeClockDelay(current));
    };
    update();
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return now;
}
