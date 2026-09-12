import { useEffect, useState } from 'react';
import { prepareArt, type GameArt } from '../game/art.js';

export function useArt(): GameArt | null {
  const [art, setArt] = useState<GameArt | null>(null);
  useEffect(() => {
    let cancelled = false;
    void prepareArt()
      .then((result) => {
        if (!cancelled) setArt(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return art;
}

export function Portrait({ look = 0 }: { look?: number }): JSX.Element {
  const art = useArt();
  return (
    <span className="portrait">{art !== null && <img src={art.portraits[look]} alt="" />}</span>
  );
}

export function ItemArt({ id }: { id: string }): JSX.Element {
  const art = useArt();
  return (
    <span className="item-art">
      {art?.icons[id] !== undefined && <img src={art.icons[id]} alt="" />}
    </span>
  );
}
