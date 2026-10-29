import React, { useId } from 'react';

export interface LogoProps {
  className?: string;
  colored?: boolean;
  strokeWidth?: number;
}

/**
 * Logo: Ahilik şed kuşağı, çağrı grafiği düğümleri ve stilize "A" harfi.
 * Renkler: Çini mavisi / Selçuklu turkuazı ve Ahilik zanaat altını/bakır.
 * Sıfır kenar boşluğuyla kompakt ve net geometrili ikon.
 */
export const Logo: React.FC<LogoProps> = ({ className = 'h-4 w-4', colored = false, strokeWidth }) => {
  const uid = `ahi-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  if (!colored) {
    return (
      <svg
        viewBox="0 0 100 100"
        className={className}
        fill="none"
        stroke="currentColor"
        aria-hidden="true"
        strokeWidth={strokeWidth}
      >
        <path
          d="M 15 87 C 15 54, 35 22, 50 11 C 65 22, 85 54, 85 87"
          strokeWidth={strokeWidth ?? 10}
          strokeLinecap="round"
        />
        <path
          d="M 21 59 C 33 53, 41 65, 50 59 C 59 53, 67 65, 79 59"
          strokeWidth={strokeWidth ?? 8}
          strokeLinecap="round"
        />
        <circle cx="50" cy="59" r="9.5" fill="var(--vscode-sideBar-background, #1e1e1e)" strokeWidth={3} />
        <circle cx="50" cy="59" r="4" fill="currentColor" stroke="none" />
        <circle cx="50" cy="11" r="8" fill="var(--vscode-sideBar-background, #1e1e1e)" strokeWidth={2.5} />
        <circle cx="50" cy="11" r="3.2" fill="currentColor" stroke="none" />
        <circle cx="15" cy="87" r="7.5" fill="var(--vscode-sideBar-background, #1e1e1e)" strokeWidth={2.5} />
        <circle cx="15" cy="87" r="2.8" fill="currentColor" stroke="none" />
        <circle cx="85" cy="87" r="7.5" fill="var(--vscode-sideBar-background, #1e1e1e)" strokeWidth={2.5} />
        <circle cx="85" cy="87" r="2.8" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 100 100" className={className} fill="none" aria-hidden="true" strokeWidth={strokeWidth}>
      <defs>
        <linearGradient
          id={`${uid}-sash-left`}
          x1="15"
          y1="87"
          x2="50"
          y2="11"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#0284c7" />
          <stop offset="45%" stopColor="#06b6d4" />
          <stop offset="100%" stopColor="#22d3ee" />
        </linearGradient>
        <linearGradient
          id={`${uid}-sash-right`}
          x1="50"
          y1="11"
          x2="85"
          y2="87"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="45%" stopColor="#0ea5e9" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>
        <linearGradient id={`${uid}-knot`} x1="20" y1="59" x2="80" y2="59" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#06b6d4" />
          <stop offset="50%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#0ea5e9" />
        </linearGradient>
        <linearGradient id={`${uid}-gold`} x1="41" y1="50" x2="59" y2="68" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fde047" />
          <stop offset="40%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#b45309" />
        </linearGradient>
        <linearGradient id={`${uid}-copper`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
        <radialGradient id={`${uid}-bg`} cx="50" cy="50" r="50" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0c2340" />
          <stop offset="70%" stopColor="#081528" />
          <stop offset="100%" stopColor="#040b14" />
        </radialGradient>
      </defs>

      {/* Kenara sıfır çini mavisi zemin */}
      <rect
        x="0"
        y="0"
        width="100"
        height="100"
        rx="20"
        fill={`url(#${uid}-bg)`}
        stroke="#0ea5e9"
        strokeWidth="1.5"
        strokeOpacity="0.35"
      />

      {/* Şed Kuşağı / A Harfi Sol & Sağ Bacak */}
      <path
        d="M 15 87 C 15 54, 35 22, 50 11"
        stroke={`url(#${uid}-sash-left)`}
        strokeWidth={strokeWidth ?? 10}
        strokeLinecap="round"
      />
      <path
        d="M 50 11 C 65 22, 85 54, 85 87"
        stroke={`url(#${uid}-sash-right)`}
        strokeWidth={strokeWidth ?? 10}
        strokeLinecap="round"
      />

      {/* Düğüm kuşağı yatay bağ */}
      <path
        d="M 21 59 C 33 53, 41 65, 50 59 C 59 53, 67 65, 79 59"
        stroke={`url(#${uid}-knot)`}
        strokeWidth={strokeWidth ?? 8}
        strokeLinecap="round"
      />

      {/* Şed Düğümü Merkezi */}
      <circle cx="50" cy="59" r="9.5" fill="#040b14" stroke={`url(#${uid}-gold)`} strokeWidth="3" />
      <circle cx="50" cy="59" r="4" fill={`url(#${uid}-gold)`} />

      {/* Düğümler: Tepe (Usta), Sol Alt (Çırak), Sağ Alt (Kalfa) */}
      <circle cx="50" cy="11" r="8" fill="#040b14" stroke={`url(#${uid}-copper)`} strokeWidth="2.5" />
      <circle cx="50" cy="11" r="3.2" fill="#38bdf8" />

      <circle cx="15" cy="87" r="7.5" fill="#040b14" stroke="#38bdf8" strokeWidth="2.5" />
      <circle cx="15" cy="87" r="2.8" fill={`url(#${uid}-gold)`} />

      <circle cx="85" cy="87" r="7.5" fill="#040b14" stroke="#38bdf8" strokeWidth="2.5" />
      <circle cx="85" cy="87" r="2.8" fill={`url(#${uid}-gold)`} />
    </svg>
  );
};
