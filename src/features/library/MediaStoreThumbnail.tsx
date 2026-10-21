import React, { useEffect, useRef, useState } from 'react';

import { loadMediaThumbnail, type MediaStoreItem } from '../../platform/androidMediaStore';

export function MediaStoreThumbnail({ item }: { item: MediaStoreItem }): React.JSX.Element {
  const host = useRef<HTMLSpanElement>(null);
  const [source, setSource] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      void loadMediaThumbnail(item, controller.signal).then(setSource).catch(() => undefined);
    }, { rootMargin: '120px' });
    if (host.current) observer.observe(host.current);
    return () => { observer.disconnect(); controller.abort(); };
  }, [item]);
  return <span ref={host} className="kml-thumbnail">{source && <img src={source} alt="" loading="lazy" />}</span>;
}
