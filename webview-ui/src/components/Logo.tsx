import React, { useId } from 'react';

export interface LogoProps {
  className?: string;
  /** Marka mavisi gradyanı; kapalıyken temanın ön plan rengini kullanır. */
  colored?: boolean;
  strokeWidth?: number;
}

/**
 * AhiCode A markası: stiliZe edilmiş "A" ve içindeki `</>` kod parantezleri.
 * Tek bir bileşik yoldur (evenodd), böylece küçük boyutlarda da net kalır.
 * Rengi `currentColor` ya da marka gradyanıdır; kapsayıcı tema rengini verir.
 */
export const Logo: React.FC<LogoProps> = ({ className = 'h-4 w-4', colored = false }) => {
  const uid = `ahi-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const markPath =
    'M 222 113 L 288 113 L 304 119 L 317 131 L 475 397 L 411 397 L 395 390 L 381 374 L 325 266 L 309 254 L 279 250 L 267 245 L 255 233 L 244 213 L 139 383 L 128 391 L 112 396 L 37 396 L 195 133 L 207 120 Z M 275 282 L 298 282 L 298 284 L 261 395 L 259 398 L 236 398 Z M 308 300 L 315 302 L 341 329 L 349 338 L 350 347 L 315 384 L 303 386 L 298 381 L 300 370 L 326 345 L 326 342 L 300 315 L 300 305 Z M 222 301 L 233 302 L 236 305 L 236 314 L 207 344 L 234 374 L 233 382 L 225 387 L 217 384 L 183 346 L 185 337 Z';

  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden="true" role="presentation">
      {colored && (
        <defs>
          <linearGradient id={`${uid}-blue`} x1="0" y1="0" x2="0.75" y2="1">
            <stop offset="0%" stopColor="#087cff" />
            <stop offset="100%" stopColor="#0051f5" />
          </linearGradient>
        </defs>
      )}
      <path
        d={markPath}
        fill={colored ? `url(#${uid}-blue)` : 'currentColor'}
        fillRule="evenodd"
        clipRule="evenodd"
      />
    </svg>
  );
};
