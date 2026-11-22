// Line-art "laundry day" scene for the home hero: a spray bottle mists a window, a sponge wipes it clean,
// sparkles appear and the laundry sways on the line. Pure SVG + CSS (no libraries), one 7 s loop.
const MIST = [
  [62, -26], [78, -8], [70, 12], [92, 26], [56, 2], [86, -40], [100, 6], [66, 34], [104, -20],
];
const BUBBLES = [
  [70, 470, 9, 0], [150, 488, 6, 1.6], [236, 480, 11, 3.1], [328, 492, 7, 0.8], [420, 476, 10, 2.4], [470, 492, 5, 4.2],
];

export default function CleaningScene() {
  return (
    <div className="scene" role="img" aria-label="Ilustración animada: un rociador limpia una ventana mientras la ropa se seca al sol">
      <svg viewBox="0 0 520 520" className="scene__svg" aria-hidden="true">
        <defs>
          <radialGradient id="scene-glow" cx="50%" cy="46%" r="55%">
            <stop offset="0%" stopColor="rgba(217,180,94,.20)" />
            <stop offset="70%" stopColor="rgba(217,180,94,0)" />
          </radialGradient>
          <linearGradient id="scene-glass" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgba(240,206,120,.10)" />
            <stop offset="100%" stopColor="rgba(240,206,120,.02)" />
          </linearGradient>
          <filter id="scene-smudge" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3.5" /></filter>
          <clipPath id="scene-window"><rect x="262" y="250" width="186" height="170" rx="16" /></clipPath>
          <mask id="scene-dirt-mask" maskUnits="userSpaceOnUse" x="250" y="240" width="210" height="190">
            <rect className="scene__wipe" x="250" y="240" width="210" height="190" fill="#fff" />
          </mask>
        </defs>

        <circle cx="260" cy="250" r="250" fill="url(#scene-glow)" />
        <circle className="scene__ring" cx="260" cy="260" r="228" pathLength="1" />
        <circle className="scene__ring scene__ring--inner" cx="260" cy="260" r="214" />

        {/* Clothesline with a shirt and a towel */}
        <g className="scene__line">
          <path className="scene__stroke scene__draw" pathLength="1" d="M58 128 Q260 168 462 122" />
          <g className="scene__swing scene__swing--shirt">
            <path className="scene__stroke scene__draw" pathLength="1" d="M228 150 l-30 14 -14 26 18 8 8 -12 v58 h56 v-58 l8 12 18 -8 -14 -26 -30 -14 q-10 14 -20 0 z" />
            <path className="scene__stroke scene__stroke--thin" d="M238 150 q10 12 20 0" />
            <rect className="scene__pin" x="230" y="142" width="6" height="16" rx="2" />
            <rect className="scene__pin" x="262" y="144" width="6" height="16" rx="2" />
          </g>
          <g className="scene__swing scene__swing--towel">
            <path className="scene__stroke scene__draw" pathLength="1" d="M340 150 h62 v74 h-62 z" />
            <path className="scene__stroke scene__stroke--thin" d="M340 208 h62 M340 214 h62" />
            <rect className="scene__pin" x="346" y="142" width="6" height="16" rx="2" />
            <rect className="scene__pin" x="388" y="140" width="6" height="16" rx="2" />
          </g>
          <g className="scene__swing scene__swing--sock">
            <path className="scene__stroke scene__draw" pathLength="1" d="M118 140 v40 q0 10 10 12 l22 4 q10 2 10 -8 q0 -8 -10 -10 l-14 -2 v-36" />
            <rect className="scene__pin" x="120" y="132" width="6" height="16" rx="2" />
          </g>
        </g>

        {/* Window being cleaned */}
        <g className="scene__window">
          <rect x="262" y="250" width="186" height="170" rx="16" fill="url(#scene-glass)" />
          <g clipPath="url(#scene-window)">
            <g mask="url(#scene-dirt-mask)" className="scene__dirt">
              <g filter="url(#scene-smudge)">
                <path d="M270 292 q34 -26 70 0 t72 -4 q16 4 36 -4 v42 q-38 20 -74 2 t-66 8 q-24 -4 -38 -12 z" />
                <ellipse cx="304" cy="380" rx="24" ry="14" /><ellipse cx="402" cy="392" rx="18" ry="11" /><circle cx="424" cy="276" r="9" />
              </g>
              <path className="scene__streak" d="M282 272 q16 10 34 0 t34 0 M372 368 q14 10 30 0 t30 0 M290 404 q12 -8 26 0" />
            </g>
            <path className="scene__shine" d="M300 250 l-50 170 h16 l50 -170 z M336 250 l-50 170 h8 l50 -170 z" />
          </g>
          <rect className="scene__stroke" x="262" y="250" width="186" height="170" rx="16" />
          <path className="scene__stroke scene__stroke--thin" d="M355 250 v170 M262 335 h186" />
          <g className="scene__sponge">
            <rect x="-26" y="-17" width="52" height="34" rx="9" className="scene__sponge-body" />
            <path className="scene__stroke scene__stroke--thin" d="M-20 -4 h40 M-20 6 h40" />
          </g>
          <g transform="translate(304 288) scale(1.1)"><path className="scene__spark scene__spark--1" d="M0 -10 C1.4 -1.4 1.4 -1.4 10 0 C1.4 1.4 1.4 1.4 0 10 C-1.4 1.4 -1.4 1.4 -10 0 C-1.4 -1.4 -1.4 -1.4 0 -10 Z" /></g>
          <g transform="translate(418 314) scale(1.5)"><path className="scene__spark scene__spark--2" d="M0 -10 C1.4 -1.4 1.4 -1.4 10 0 C1.4 1.4 1.4 1.4 0 10 C-1.4 1.4 -1.4 1.4 -10 0 C-1.4 -1.4 -1.4 -1.4 0 -10 Z" /></g>
          <g transform="translate(382 394) scale(.9)"><path className="scene__spark scene__spark--3" d="M0 -10 C1.4 -1.4 1.4 -1.4 10 0 C1.4 1.4 1.4 1.4 0 10 C-1.4 1.4 -1.4 1.4 -10 0 C-1.4 -1.4 -1.4 -1.4 0 -10 Z" /></g>
        </g>

        {/* Spray bottle */}
        <g className="scene__bottle">
          <path className="scene__stroke scene__draw" pathLength="1" d="M112 300 h68 a12 12 0 0 1 12 12 v118 a16 16 0 0 1 -16 16 h-60 a16 16 0 0 1 -16 -16 v-118 a12 12 0 0 1 12 -12 z" />
          <path className="scene__liquid" d="M104 352 q22 -10 44 0 t44 0 v78 a16 16 0 0 1 -16 16 h-60 a16 16 0 0 1 -16 -16 z" />
          <rect className="scene__stroke" x="126" y="276" width="40" height="24" rx="4" />
          <path className="scene__stroke scene__draw" pathLength="1" d="M120 276 v-24 a12 12 0 0 1 12 -12 h50 l44 8 v16 l-44 6 v6 z" />
          <path className="scene__stroke scene__stroke--thin" d="M226 248 h8 v16 h-8" />
          <path className="scene__trigger scene__stroke" d="M178 270 q8 22 -6 40" />
          <rect className="scene__label" x="122" y="372" width="48" height="44" rx="8" />
          <path className="scene__label-drop" d="M146 382 q-9 12 -9 18 a9 9 0 0 0 18 0 q0 -6 -9 -18 z" />
        </g>

        {/* Mist from the nozzle */}
        <g className="scene__mist" transform="translate(236 256)">
          {MIST.map(([x, y], i) => <circle key={i} className="scene__drop" r={i % 3 === 0 ? 4 : 2.8} style={{ '--x': `${x}px`, '--y': `${y}px`, '--d': `${(i % 4) * 0.06}s` }} />)}
          <path className="scene__cone" d="M0 0 L96 -44 Q112 0 96 44 Z" />
        </g>

        {/* Bubbles */}
        {BUBBLES.map(([x, y, r, d], i) => (
          <g key={i} className="scene__bubble" style={{ '--delay': `${d}s` }}>
            <circle cx={x} cy={y} r={r} />
            <path d={`M${x - r * 0.45} ${y - r * 0.2} a${r * 0.5} ${r * 0.5} 0 0 1 ${r * 0.45} -${r * 0.4}`} />
          </g>
        ))}
      </svg>
    </div>
  );
}
