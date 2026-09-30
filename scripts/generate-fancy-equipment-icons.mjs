import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const dir = resolve(process.cwd(), "public/equipment");

// 1. RALLONGE (Industrial Heavy-Duty Cable Reel Drum) - High-Vis Orange & Charcoal
const rallongeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" role="img" aria-label="High-visibility industrial cable extension reel">
  <defs>
    <linearGradient id="ral-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fff7ed" />
      <stop offset="50%" stop-color="#ffedd5" />
      <stop offset="100%" stop-color="#fed7aa" />
    </linearGradient>
    <linearGradient id="ral-orange" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fb923c" />
      <stop offset="50%" stop-color="#ea580c" />
      <stop offset="100%" stop-color="#c2410c" />
    </linearGradient>
    <linearGradient id="ral-cable" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#f97316" />
      <stop offset="30%" stop-color="#fb923c" />
      <stop offset="70%" stop-color="#ea580c" />
      <stop offset="100%" stop-color="#9a3412" />
    </linearGradient>
    <linearGradient id="ral-frame" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#475569" />
      <stop offset="50%" stop-color="#1e293b" />
      <stop offset="100%" stop-color="#0f172a" />
    </linearGradient>
    <linearGradient id="ral-metal" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#e2e8f0" />
      <stop offset="50%" stop-color="#94a3b8" />
      <stop offset="100%" stop-color="#64748b" />
    </linearGradient>
    <linearGradient id="ral-brass" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fef08a" />
      <stop offset="50%" stop-color="#eab308" />
      <stop offset="100%" stop-color="#a16207" />
    </linearGradient>
    <radialGradient id="ral-drum-center" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#334155" />
      <stop offset="85%" stop-color="#1e293b" />
      <stop offset="100%" stop-color="#0f172a" />
    </radialGradient>
    <filter id="ral-shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#7c2d12" flood-opacity="0.22" />
    </filter>
  </defs>

  <!-- Canvas Background -->
  <rect width="800" height="600" rx="32" fill="url(#ral-bg)" />

  <!-- Subtle Engineering Grid -->
  <g stroke="#ea580c" stroke-width="1" opacity="0.08">
    <line x1="80" y1="0" x2="80" y2="600" />
    <line x1="160" y1="0" x2="160" y2="600" />
    <line x1="240" y1="0" x2="240" y2="600" />
    <line x1="320" y1="0" x2="320" y2="600" />
    <line x1="400" y1="0" x2="400" y2="600" />
    <line x1="480" y1="0" x2="480" y2="600" />
    <line x1="560" y1="0" x2="560" y2="600" />
    <line x1="640" y1="0" x2="640" y2="600" />
    <line x1="720" y1="0" x2="720" y2="600" />
    <line x1="0" y1="80" x2="800" y2="800" />
    <line x1="0" y1="160" x2="800" y2="160" />
    <line x1="0" y1="240" x2="800" y2="240" />
    <line x1="0" y1="320" x2="800" y2="320" />
    <line x1="0" y1="400" x2="800" y2="400" />
    <line x1="0" y1="480" x2="800" y2="480" />
  </g>

  <!-- Ambient Ground Shadow -->
  <ellipse cx="380" cy="515" rx="270" ry="36" fill="#431407" opacity="0.18" />
  <ellipse cx="610" cy="495" rx="85" ry="18" fill="#431407" opacity="0.14" />

  <!-- Heavy Duty Tubular Steel Stand (Back Leg) -->
  <path d="M290 490 L240 500 L210 320 L270 120" stroke="url(#ral-frame)" stroke-width="26" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.75" />

  <!-- Main Cable Reel Drum Assembly -->
  <g filter="url(#ral-shadow)">
    <!-- Rear Flange Disc -->
    <ellipse cx="360" cy="305" rx="195" ry="195" fill="#1e293b" stroke="#0f172a" stroke-width="8" />

    <!-- Multiple Coiled High-Vis Orange Cable Layers -->
    <g fill="none" stroke="url(#ral-cable)" stroke-width="22" stroke-linecap="round">
      <ellipse cx="360" cy="305" rx="172" ry="172" stroke="#ea580c" />
      <ellipse cx="360" cy="305" rx="154" ry="154" stroke="#f97316" />
      <ellipse cx="360" cy="305" rx="136" ry="136" stroke="#fb923c" />
      <ellipse cx="360" cy="305" rx="118" ry="118" stroke="#f97316" />
    </g>

    <!-- Front Drum Circular Faceplate -->
    <circle cx="360" cy="305" r="105" fill="url(#ral-drum-center)" stroke="url(#ral-orange)" stroke-width="8" />
    <circle cx="360" cy="305" r="95" fill="#0f172a" stroke="#334155" stroke-width="3" />

    <!-- 2 Built-in French/Schuko Grounded Sockets on Faceplate -->
    <!-- Socket 1 (Top) -->
    <circle cx="360" cy="255" r="30" fill="#1e293b" stroke="#475569" stroke-width="3" />
    <circle cx="350" cy="255" r="4.5" fill="#020617" />
    <circle cx="370" cy="255" r="4.5" fill="#020617" />
    <rect x="357" y="235" width="6" height="8" rx="2" fill="url(#ral-brass)" />
    <rect x="357" y="267" width="6" height="8" rx="2" fill="url(#ral-brass)" />

    <!-- Socket 2 (Bottom) -->
    <circle cx="360" cy="345" r="30" fill="#1e293b" stroke="#475569" stroke-width="3" />
    <circle cx="350" cy="345" r="4.5" fill="#020617" />
    <circle cx="370" cy="345" r="4.5" fill="#020617" />
    <rect x="357" y="325" width="6" height="8" rx="2" fill="url(#ral-brass)" />
    <rect x="357" y="357" width="6" height="8" rx="2" fill="url(#ral-brass)" />

    <!-- Thermal Overload Cutout Switch (Red Button) & Indicator -->
    <circle cx="305" cy="305" r="10" fill="#dc2626" stroke="#ef4444" stroke-width="2" />
    <circle cx="305" cy="305" r="5" fill="#f87171" />
    <text x="305" y="325" font-family="sans-serif" font-size="8" font-weight="bold" fill="#94a3b8" text-anchor="middle">RESET</text>

    <!-- Winding Handle Crank on Drum -->
    <g transform="translate(425 295)">
      <rect x="0" y="-8" width="30" height="16" rx="6" fill="#475569" />
      <circle cx="28" cy="0" r="14" fill="#f97316" stroke="#ea580c" stroke-width="3" />
      <circle cx="28" cy="0" r="7" fill="#0f172a" />
    </g>

    <!-- Center Technical Markings -->
    <text x="360" y="303" font-family="sans-serif" font-size="11" font-weight="900" fill="#ea580c" text-anchor="middle" letter-spacing="1">3000W</text>
    <text x="360" y="315" font-family="sans-serif" font-size="8" font-weight="bold" fill="#64748b" text-anchor="middle">230V ~ 16A</text>
  </g>

  <!-- Front Tubular Steel Stand & Handle -->
  <path d="M260 505 L220 505 L260 300 L320 90 L400 90 L460 300 L500 505 L460 505" stroke="url(#ral-frame)" stroke-width="24" stroke-linecap="round" stroke-linejoin="round" fill="none" />
  <!-- Ergonomic Orange Comfort Grip on Top Handle -->
  <rect x="330" y="77" width="60" height="26" rx="8" fill="url(#ral-orange)" stroke="#c2410c" stroke-width="3" />
  <!-- Rubber Anti-Slip Feet -->
  <rect x="210" y="495" width="40" height="20" rx="6" fill="#0f172a" />
  <rect x="470" y="495" width="40" height="20" rx="6" fill="#0f172a" />

  <!-- Unspooled Dynamic Extension Cable to the Front-Right -->
  <path d="M430 430 C490 490 520 480 570 470 C610 460 630 475 660 470" stroke="url(#ral-cable)" stroke-width="18" stroke-linecap="round" fill="none" />

  <!-- Heavy Duty European Plug on Forefront -->
  <g transform="translate(640 435) rotate(-18)">
    <!-- Strain Relief Boot -->
    <path d="M-22 18 L-8 15 L-8 33 L-22 30 Z" fill="#334155" />
    <!-- Plug Body -->
    <rect x="-8" y="10" width="55" height="30" rx="8" fill="#1e293b" stroke="#0f172a" stroke-width="3" />
    <!-- High-Vis Grip Ring -->
    <rect x="2" y="12" width="10" height="26" rx="3" fill="url(#ral-orange)" />
    <!-- Plug Face & Brass Prongs -->
    <rect x="47" y="15" width="18" height="6" rx="2" fill="url(#ral-brass)" />
    <rect x="47" y="27" width="18" height="6" rx="2" fill="url(#ral-brass)" />
    <circle cx="50" cy="24" r="3" fill="#cbd5e1" />
  </g>
</svg>`;

// 2. MULTIPRISE (Sleek Surge Protector Multi-Outlet Strip with USB-C & Glowing Switch)
const multipriseSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" role="img" aria-label="Surge protected multi-outlet power strip">
  <defs>
    <linearGradient id="mp-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f8fafc" />
      <stop offset="50%" stop-color="#f1f5f9" />
      <stop offset="100%" stop-color="#e2e8f0" />
    </linearGradient>
    <linearGradient id="mp-body" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="60%" stop-color="#f8fafc" />
      <stop offset="100%" stop-color="#e2e8f0" />
    </linearGradient>
    <linearGradient id="mp-switch" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f87171" />
      <stop offset="40%" stop-color="#ef4444" />
      <stop offset="100%" stop-color="#b91c1c" />
    </linearGradient>
    <radialGradient id="mp-neon" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#fca5a5" stop-opacity="0.9" />
      <stop offset="40%" stop-color="#ef4444" stop-opacity="0.5" />
      <stop offset="100%" stop-color="#ef4444" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="mp-cord" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#2563eb" />
      <stop offset="50%" stop-color="#1d4ed8" />
      <stop offset="100%" stop-color="#1e3a8a" />
    </linearGradient>
    <linearGradient id="mp-brass" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#fde047" />
      <stop offset="60%" stop-color="#ca8a04" />
      <stop offset="100%" stop-color="#854d0e" />
    </linearGradient>
    <filter id="mp-shadow" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#0f172a" flood-opacity="0.16" />
    </filter>
  </defs>

  <!-- Canvas Background -->
  <rect width="800" height="600" rx="32" fill="url(#mp-bg)" />

  <!-- Technical Circuit Pattern in Background -->
  <g stroke="#3b82f6" stroke-width="1.5" opacity="0.1" fill="none">
    <path d="M100 120 h120 l40 40 h150" />
    <circle cx="100" cy="120" r="4" fill="#3b82f6" />
    <path d="M680 480 h-100 l-30 -30 h-120" />
    <circle cx="680" cy="480" r="4" fill="#3b82f6" />
  </g>

  <!-- Ambient Shadow -->
  <ellipse cx="400" cy="440" rx="330" ry="40" fill="#334155" opacity="0.18" />

  <!-- Braided Electric Blue Power Cord (Flexible Curve) -->
  <path d="M120 480 C110 390 140 320 200 270 C240 235 280 230 330 220" stroke="url(#mp-cord)" stroke-width="22" stroke-linecap="round" fill="none" />
  <!-- Cable Strain Relief -->
  <g transform="translate(325 210) rotate(-14)">
    <rect x="0" y="0" width="30" height="26" rx="5" fill="#475569" />
    <line x1="8" y1="0" x2="8" y2="26" stroke="#1e293b" stroke-width="2" />
    <line x1="16" y1="0" x2="16" y2="26" stroke="#1e293b" stroke-width="2" />
    <line x1="24" y1="0" x2="24" y2="26" stroke="#1e293b" stroke-width="2" />
  </g>

  <!-- Main Power Strip Enclosure (Angled Perspective) -->
  <g transform="translate(410 325) rotate(-14)" filter="url(#mp-shadow)">
    <!-- Base Plate -->
    <rect x="-260" y="-70" width="530" height="140" rx="28" fill="#cbd5e1" />
    <!-- Main Top Housing -->
    <rect x="-258" y="-75" width="526" height="135" rx="26" fill="url(#mp-body)" stroke="#cbd5e1" stroke-width="3" />

    <!-- Illuminated Rocker Master Power Switch -->
    <g transform="translate(-205 -8)">
      <!-- Switch Bezel Frame -->
      <rect x="-24" y="-36" width="48" height="72" rx="10" fill="#1e293b" stroke="#334155" stroke-width="2" />
      <!-- Neon Switch Glow -->
      <ellipse cx="0" cy="-6" rx="32" ry="36" fill="url(#mp-neon)" />
      <!-- Rocker Button (Pressed ON state) -->
      <rect x="-18" y="-30" width="36" height="60" rx="7" fill="url(#mp-switch)" stroke="#fca5a5" stroke-width="1.5" />
      <!-- Power ON Indicator Symbol -->
      <line x1="0" y1="-20" x2="0" y2="-6" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round" />
      <circle cx="0" cy="14" r="5" stroke="#ffffff" stroke-width="3" fill="none" opacity="0.75" />
    </g>

    <!-- Surge Protection Status LEDs -->
    <g transform="translate(-150 -44)">
      <!-- Protected LED (Green) -->
      <circle cx="0" cy="0" r="5" fill="#22c55e" stroke="#86efac" stroke-width="1.5" />
      <text x="10" y="3.5" font-family="sans-serif" font-size="8" font-weight="bold" fill="#64748b">SURGE PROTECTED</text>
      <!-- Grounded LED (Blue) -->
      <circle cx="0" cy="18" r="5" fill="#3b82f6" stroke="#93c5fd" stroke-width="1.5" />
      <text x="10" y="21.5" font-family="sans-serif" font-size="8" font-weight="bold" fill="#64748b">GROUNDED</text>
    </g>

    <!-- 4 Angled French/European Sockets (45° Diagonal) -->
    <!-- Socket 1 -->
    <g transform="translate(-60 0)">
      <circle cx="0" cy="0" r="42" fill="#f1f5f9" stroke="#cbd5e1" stroke-width="2.5" />
      <circle cx="0" cy="0" r="36" fill="#e2e8f0" />
      <!-- Socket Holes (45 deg) -->
      <circle cx="-13" cy="-13" r="6" fill="#0f172a" />
      <circle cx="13" cy="13" r="6" fill="#0f172a" />
      <!-- Ground Pin -->
      <circle cx="-13" cy="13" r="5" fill="url(#mp-brass)" stroke="#78350f" stroke-width="1" />
    </g>

    <!-- Socket 2 -->
    <g transform="translate(40 0)">
      <circle cx="0" cy="0" r="42" fill="#f1f5f9" stroke="#cbd5e1" stroke-width="2.5" />
      <circle cx="0" cy="0" r="36" fill="#e2e8f0" />
      <circle cx="-13" cy="-13" r="6" fill="#0f172a" />
      <circle cx="13" cy="13" r="6" fill="#0f172a" />
      <circle cx="-13" cy="13" r="5" fill="url(#mp-brass)" stroke="#78350f" stroke-width="1" />
    </g>

    <!-- Socket 3 -->
    <g transform="translate(140 0)">
      <circle cx="0" cy="0" r="42" fill="#f1f5f9" stroke="#cbd5e1" stroke-width="2.5" />
      <circle cx="0" cy="0" r="36" fill="#e2e8f0" />
      <circle cx="-13" cy="-13" r="6" fill="#0f172a" />
      <circle cx="13" cy="13" r="6" fill="#0f172a" />
      <circle cx="-13" cy="13" r="5" fill="url(#mp-brass)" stroke="#78350f" stroke-width="1" />
    </g>

    <!-- Smart Fast-Charging Station (Dual USB-C PD + USB-A QuickCharge) -->
    <g transform="translate(225 0)">
      <rect x="-18" y="-48" width="36" height="96" rx="8" fill="#1e293b" />
      <!-- USB-C Port 1 -->
      <rect x="-10" y="-38" width="20" height="8" rx="4" fill="#0f172a" stroke="#38bdf8" stroke-width="1.5" />
      <text x="0" y="-24" font-family="sans-serif" font-size="7" font-weight="900" fill="#38bdf8" text-anchor="middle">PD 45W</text>
      <!-- USB-C Port 2 -->
      <rect x="-10" y="-14" width="20" height="8" rx="4" fill="#0f172a" stroke="#38bdf8" stroke-width="1.5" />
      <!-- USB-A Port -->
      <rect x="-11" y="10" width="22" height="12" rx="3" fill="#0f172a" stroke="#f59e0b" stroke-width="1.5" />
      <rect x="-8" y="14" width="16" height="4" fill="#3b82f6" />
      <text x="0" y="36" font-family="sans-serif" font-size="7" font-weight="bold" fill="#94a3b8" text-anchor="middle">QC 3.0</text>
    </g>
  </g>
</svg>`;

// 3. PROJECTEUR (Digital Laser / 4K Cinema Projector with Radiant Sapphire/Cyan Optical Lens)
const projecteurSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" role="img" aria-label="Digital laser video projector with optical glass lens">
  <defs>
    <linearGradient id="prj-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f0f9ff" />
      <stop offset="50%" stop-color="#e0f2fe" />
      <stop offset="100%" stop-color="#bae6fd" />
    </linearGradient>
    <linearGradient id="prj-body" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="40%" stop-color="#f8fafc" />
      <stop offset="100%" stop-color="#cbd5e1" />
    </linearGradient>
    <linearGradient id="prj-front" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1e293b" />
      <stop offset="100%" stop-color="#0f172a" />
    </linearGradient>
    <radialGradient id="prj-lens" cx="42%" cy="42%" r="58%">
      <stop offset="0%" stop-color="#67e8f9" />
      <stop offset="25%" stop-color="#00b5e2" />
      <stop offset="60%" stop-color="#00629b" />
      <stop offset="85%" stop-color="#981d97" />
      <stop offset="100%" stop-color="#002855" />
    </radialGradient>
    <linearGradient id="prj-flare" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.6" />
      <stop offset="30%" stop-color="#00b5e2" stop-opacity="0.3" />
      <stop offset="100%" stop-color="#00629b" stop-opacity="0" />
    </linearGradient>
    <filter id="prj-shadow" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="0" dy="20" stdDeviation="22" flood-color="#002855" flood-opacity="0.25" />
    </filter>
  </defs>

  <!-- Background -->
  <rect width="800" height="600" rx="32" fill="url(#prj-bg)" />

  <!-- Luminous Optical Projection Light Beam -->
  <polygon points="340,320 800,120 800,520 340,320" fill="url(#prj-flare)" />

  <!-- Ground Ambient Drop Shadow -->
  <ellipse cx="390" cy="485" rx="290" ry="34" fill="#002855" opacity="0.22" />

  <!-- Projector Elevation Feet -->
  <rect x="200" y="440" width="34" height="22" rx="5" fill="#334155" stroke="#64748b" stroke-width="2" />
  <rect x="520" y="440" width="34" height="22" rx="5" fill="#334155" stroke="#64748b" stroke-width="2" />

  <!-- Main Chassis Assembly -->
  <g filter="url(#prj-shadow)">
    <!-- Main Projector Enclosure -->
    <rect x="150" y="210" width="460" height="240" rx="26" fill="url(#prj-body)" stroke="#94a3b8" stroke-width="3" />

    <!-- Front Bezel Plate (Dark Tech Contrast) -->
    <rect x="170" y="230" width="420" height="195" rx="18" fill="url(#prj-front)" />

    <!-- Precision Airflow Ventilation Slits (Left Side) -->
    <g fill="#020617" opacity="0.85">
      <rect x="185" y="260" width="6" height="130" rx="3" />
      <rect x="197" y="260" width="6" height="130" rx="3" />
      <rect x="209" y="260" width="6" height="130" rx="3" />
      <rect x="221" y="260" width="6" height="130" rx="3" />
      <rect x="233" y="260" width="6" height="130" rx="3" />
      <rect x="245" y="260" width="6" height="130" rx="3" />
    </g>

    <!-- Professional Multi-Element Optical Glass Lens Assembly -->
    <g transform="translate(340 325)">
      <!-- Outer Metal Lens Barrel Ring -->
      <circle cx="0" cy="0" r="76" fill="#334155" stroke="#64748b" stroke-width="4" />
      <circle cx="0" cy="0" r="70" fill="#0f172a" />
      <!-- Textured Ribbed Focus Ring -->
      <circle cx="0" cy="0" r="66" fill="none" stroke="#475569" stroke-width="5" stroke-dasharray="6,4" />
      <!-- Deep Blue / Sapphire Glass Lens Element -->
      <circle cx="0" cy="0" r="58" fill="url(#prj-lens)" stroke="#38bdf8" stroke-width="3" />
      <!-- Lens Aperture Reflections (Curved Specular Glints) -->
      <ellipse cx="-16" cy="-18" rx="24" ry="12" transform="rotate(-30 -16 -18)" fill="#ffffff" opacity="0.45" />
      <circle cx="18" cy="18" r="8" fill="#67e8f9" opacity="0.5" />
      <!-- Inner Core Laser Aperture -->
      <circle cx="0" cy="0" r="14" fill="#38bdf8" opacity="0.8" />
      <circle cx="0" cy="0" r="6" fill="#ffffff" />
    </g>

    <!-- Front Sensor Array & Status Indicators (Right Side) -->
    <g transform="translate(470 260)">
      <!-- 4K Laser Cinema Badge -->
      <rect x="0" y="0" width="95" height="30" rx="6" fill="#1e293b" stroke="#334155" stroke-width="1.5" />
      <text x="47" y="16" font-family="sans-serif" font-size="10" font-weight="900" fill="#00b5e2" text-anchor="middle" letter-spacing="1">4K LASER</text>
      <text x="47" y="26" font-family="sans-serif" font-size="7" font-weight="bold" fill="#94a3b8" text-anchor="middle">5000 ANSI LUMENS</text>

      <!-- IR Remote Receiver Sensor Window -->
      <circle cx="20" cy="55" r="9" fill="#020617" stroke="#334155" stroke-width="2" />
      <circle cx="20" cy="55" r="4" fill="#ef4444" opacity="0.7" />
      <text x="36" y="58" font-family="sans-serif" font-size="8" font-weight="bold" fill="#64748b">IR REMOTE</text>

      <!-- Status LED Panel -->
      <g transform="translate(10 85)">
        <circle cx="0" cy="0" r="5" fill="#22c55e" stroke="#86efac" stroke-width="1.5" />
        <text x="12" y="3.5" font-family="sans-serif" font-size="8" font-weight="bold" fill="#cbd5e1">POWER</text>
        <circle cx="0" cy="20" r="5" fill="#38bdf8" stroke="#bae6fd" stroke-width="1.5" />
        <text x="12" y="23.5" font-family="sans-serif" font-size="8" font-weight="bold" fill="#cbd5e1">LAMP READY</text>
        <circle cx="0" cy="40" r="5" fill="#eab308" opacity="0.4" />
        <text x="12" y="43.5" font-family="sans-serif" font-size="8" font-weight="bold" fill="#64748b">TEMP</text>
      </g>
    </g>

    <!-- Top Surface Control Dial & Keystoning Adjustment -->
    <g transform="translate(370 210)">
      <rect x="-60" y="-12" width="120" height="12" rx="4" fill="#94a3b8" />
      <circle cx="-30" cy="-6" r="10" fill="#334155" />
      <circle cx="30" cy="-6" r="10" fill="#334155" />
    </g>
  </g>
</svg>`;

// 4. CABLE HDMI (Ultra-Fast 8K Braided Nylon HDMI Cable with Gold Plated Connectors)
const hdmiSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" role="img" aria-label="Ultra high-speed 8K HDMI cable with gold-plated connectors">
  <defs>
    <linearGradient id="hd-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f8fafc" />
      <stop offset="50%" stop-color="#f1f5f9" />
      <stop offset="100%" stop-color="#e0f2fe" />
    </linearGradient>
    <linearGradient id="hd-gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fef08a" />
      <stop offset="35%" stop-color="#eab308" />
      <stop offset="70%" stop-color="#ca8a04" />
      <stop offset="100%" stop-color="#854d0e" />
    </linearGradient>
    <linearGradient id="hd-metal" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#475569" />
      <stop offset="40%" stop-color="#1e293b" />
      <stop offset="100%" stop-color="#0f172a" />
    </linearGradient>
    <linearGradient id="hd-braid" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0284c7" />
      <stop offset="35%" stop-color="#0369a1" />
      <stop offset="70%" stop-color="#1e293b" />
      <stop offset="100%" stop-color="#0f172a" />
    </linearGradient>
    <filter id="hd-shadow" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="0" dy="18" stdDeviation="20" flood-color="#0284c7" flood-opacity="0.2" />
    </filter>
  </defs>

  <!-- Background Canvas -->
  <rect width="800" height="600" rx="32" fill="url(#hd-bg)" />

  <!-- Diagonal Tech Accent Lines -->
  <g stroke="#0284c7" stroke-width="1.5" opacity="0.1" fill="none">
    <line x1="0" y1="200" x2="400" y2="600" />
    <line x1="100" y1="100" x2="600" y2="600" />
    <line x1="300" y1="0" x2="800" y2="500" />
  </g>

  <!-- Ambient Shadows -->
  <ellipse cx="400" cy="490" rx="280" ry="34" fill="#0f172a" opacity="0.18" />
  <ellipse cx="270" cy="380" rx="140" ry="24" fill="#0f172a" opacity="0.12" />

  <!-- Dynamic S-Curving High-Density Braided Cable Loop -->
  <g filter="url(#hd-shadow)">
    <!-- Primary Loop -->
    <path d="M180 340 C110 480 320 540 450 460 C580 380 620 220 540 180 C460 140 370 200 410 270 C440 330 520 340 600 320" stroke="url(#hd-braid)" stroke-width="26" stroke-linecap="round" fill="none" />
    <!-- Braided Nylon Micro-Texture Overlay (Dashed Stitches) -->
    <path d="M180 340 C110 480 320 540 450 460 C580 380 620 220 540 180 C460 140 370 200 410 270 C440 330 520 340 600 320" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-dasharray="4,8" fill="none" opacity="0.6" />
  </g>

  <!-- Connector Head 1 (Foreground Hero - Angled Right) -->
  <g transform="translate(230 310) rotate(-40)" filter="url(#hd-shadow)">
    <!-- Flexible Rubber Strain Relief Boot -->
    <path d="M-60 -14 L-30 -11 L-30 11 L-60 14 Z" fill="#334155" />
    <line x1="-52" y1="-13" x2="-52" y2="13" stroke="#1e293b" stroke-width="2" />
    <line x1="-42" y1="-12" x2="-42" y2="12" stroke="#1e293b" stroke-width="2" />
    <line x1="-34" y1="-11" x2="-34" y2="11" stroke="#1e293b" stroke-width="2" />

    <!-- Premium Zinc Alloy Metal Hood -->
    <rect x="-30" y="-18" width="70" height="36" rx="8" fill="url(#hd-metal)" stroke="#64748b" stroke-width="2" />
    <!-- Electric Cyan Inset Accent Stripe -->
    <rect x="-10" y="-18" width="6" height="36" fill="#00b5e2" />
    <!-- Laser Etched Specs -->
    <text x="18" y="-4" font-family="sans-serif" font-size="9" font-weight="900" fill="#ffffff" letter-spacing="1">HDMI</text>
    <text x="18" y="8" font-family="sans-serif" font-size="7" font-weight="bold" fill="#38bdf8">8K · 60Hz</text>

    <!-- 24K Gold Plated Male Connector Plug -->
    <g transform="translate(40 0)">
      <!-- Main Outer Gold Shell (Trapezoidal HDMI profile) -->
      <path d="M0 -14 L42 -14 L42 -10 L48 -6 L48 6 L42 10 L42 14 L0 14 Z" fill="url(#hd-gold)" stroke="#a16207" stroke-width="1.5" />
      <!-- Interior Black Pin Carrier -->
      <rect x="10" y="-8" width="28" height="16" rx="2" fill="#0f172a" />
      <!-- 19 Detailed Gold Contact Pins -->
      <g fill="url(#hd-gold)">
        <rect x="14" y="-6" width="18" height="2" rx="0.5" />
        <rect x="14" y="-3" width="18" height="2" rx="0.5" />
        <rect x="14" y="0" width="18" height="2" rx="0.5" />
        <rect x="14" y="3" width="18" height="2" rx="0.5" />
      </g>
      <!-- Gold Specular Shine Line -->
      <line x1="2" y1="-12" x2="40" y2="-12" stroke="#ffffff" stroke-width="1.5" opacity="0.75" />
    </g>
  </g>

  <!-- Connector Head 2 (Top Right - Secondary Perspective) -->
  <g transform="translate(620 290) rotate(145)" filter="url(#hd-shadow)">
    <path d="M-50 -12 L-25 -9 L-25 9 L-50 12 Z" fill="#334155" />
    <rect x="-25" y="-16" width="60" height="32" rx="7" fill="url(#hd-metal)" stroke="#64748b" stroke-width="1.5" />
    <rect x="-6" y="-16" width="5" height="32" fill="#00b5e2" />
    <text x="12" y="4" font-family="sans-serif" font-size="8" font-weight="bold" fill="#cbd5e1">ULTRA</text>

    <!-- Gold Connector Plug 2 -->
    <path d="M35 -12 L70 -12 L70 -8 L75 -4 L75 4 L70 8 L70 12 L35 12 Z" fill="url(#hd-gold)" stroke="#a16207" stroke-width="1.5" />
    <rect x="42" y="-7" width="24" height="14" rx="2" fill="#0f172a" />
  </g>
</svg>`;

// 5. POINTEUR (Wireless Presentation Remote with Emerald Green Laser Beam)
const pointeurSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" role="img" aria-label="Wireless presentation pointer clicker with green laser">
  <defs>
    <linearGradient id="ptr-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f0fdf4" />
      <stop offset="50%" stop-color="#dcfce7" />
      <stop offset="100%" stop-color="#bbf7d0" />
    </linearGradient>
    <linearGradient id="ptr-body" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#334155" />
      <stop offset="45%" stop-color="#1e293b" />
      <stop offset="100%" stop-color="#0f172a" />
    </linearGradient>
    <linearGradient id="ptr-laser-beam" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#86efac" stop-opacity="0.9" />
      <stop offset="25%" stop-color="#22c55e" stop-opacity="0.6" />
      <stop offset="100%" stop-color="#10b981" stop-opacity="0" />
    </linearGradient>
    <linearGradient id="ptr-btn-blue" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#00629b" />
      <stop offset="100%" stop-color="#002855" />
    </linearGradient>
    <filter id="ptr-shadow" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#064e3b" flood-opacity="0.22" />
    </filter>
  </defs>

  <!-- Background -->
  <rect width="800" height="600" rx="32" fill="url(#ptr-bg)" />

  <!-- Luminous Emerald Green Laser Beam shooting across the top -->
  <polygon points="340,165 800,90 800,140 340,165" fill="url(#ptr-laser-beam)" />
  <line x1="330" y1="165" x2="800" y2="115" stroke="#4ade80" stroke-width="4" stroke-linecap="round" />
  <circle cx="330" cy="165" r="8" fill="#ffffff" />
  <circle cx="330" cy="165" r="16" fill="#22c55e" opacity="0.6" />

  <!-- Ground Drop Shadow -->
  <ellipse cx="380" cy="490" rx="260" ry="32" fill="#064e3b" opacity="0.18" />

  <!-- Ergonomic Wireless Presenter Remote Body (Angled 35°) -->
  <g transform="translate(380 340) rotate(-35)" filter="url(#ptr-shadow)">
    <!-- Main Wand Housing with Tapered Ergonomic Grip -->
    <path d="M-40 -190 C-30 -205 30 -205 40 -190 L52 140 C52 185 -52 185 -52 140 Z" fill="url(#ptr-body)" stroke="#475569" stroke-width="3" />

    <!-- Laser Emitter Aperture Cap (Top Tip) -->
    <path d="M-30 -195 C-20 -208 20 -208 30 -195 L34 -175 L-34 -175 Z" fill="#0f172a" stroke="#10b981" stroke-width="2" />
    <circle cx="0" cy="-185" r="7" fill="#22c55e" stroke="#86efac" stroke-width="2" />

    <!-- Intuitive Navigation Button Cluster -->
    <!-- Large Convex Forward Button (Slide Next) -->
    <g transform="translate(0 -115)">
      <rect x="-30" y="-30" width="60" height="52" rx="14" fill="#334155" stroke="#475569" stroke-width="2" />
      <path d="M-10 0 L10 0 M2 -8 L10 0 L2 8" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none" />
    </g>

    <!-- Large Convex Backward Button (Slide Previous) -->
    <g transform="translate(0 -45)">
      <rect x="-30" y="-20" width="60" height="42" rx="12" fill="#1e293b" stroke="#334155" stroke-width="2" />
      <path d="M10 0 L-10 0 M-2 -8 L-10 0 L-2 8" stroke="#94a3b8" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none" />
    </g>

    <!-- Center Laser Activation Trigger Button (Glowing Emerald) -->
    <g transform="translate(0 20)">
      <circle cx="0" cy="0" r="22" fill="#10b981" stroke="#4ade80" stroke-width="2.5" />
      <!-- Laser Warning Starburst Icon -->
      <polygon points="0,-10 3,-3 10,0 3,3 0,10 -3,3 -10,0 -3,-3" fill="#ffffff" />
    </g>

    <!-- Black Screen / Presentation Start Buttons -->
    <g transform="translate(0 75)">
      <circle cx="-16" cy="0" r="10" fill="#334155" />
      <rect x="-20" y="-4" width="8" height="8" rx="1" fill="#94a3b8" />
      <circle cx="16" cy="0" r="10" fill="#334155" />
      <polygon points="13,-4 21,0 13,4" fill="#94a3b8" />
    </g>

    <!-- Battery Level LED Indicators -->
    <g transform="translate(0 115)">
      <circle cx="-12" cy="0" r="3.5" fill="#22c55e" />
      <circle cx="0" cy="0" r="3.5" fill="#22c55e" />
      <circle cx="12" cy="0" r="3.5" fill="#22c55e" />
    </g>

    <!-- Detachable USB Nano-Receiver Dock (Bottom Tail) -->
    <g transform="translate(0 155)">
      <path d="M-28 0 L28 0 L22 22 L-22 22 Z" fill="#0f172a" stroke="#334155" stroke-width="1.5" />
      <rect x="-8" y="6" width="16" height="10" rx="2" fill="#ca8a04" />
      <text x="0" y="32" font-family="sans-serif" font-size="7" font-weight="bold" fill="#64748b" text-anchor="middle">USB 2.4G</text>
    </g>
  </g>
</svg>`;

// 6. ROUTEUR (Gigabit WiFi 6/7 Dual-Band Router with Quad High-Gain Antennas & Glowing Cyan LEDs)
const routeurSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" role="img" aria-label="Gigabit WiFi 6 enterprise dual-band router with quad antennas">
  <defs>
    <linearGradient id="rt-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f8fafc" />
      <stop offset="50%" stop-color="#f1f5f9" />
      <stop offset="100%" stop-color="#e2e8f0" />
    </linearGradient>
    <linearGradient id="rt-body" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1e293b" />
      <stop offset="50%" stop-color="#0f172a" />
      <stop offset="100%" stop-color="#020617" />
    </linearGradient>
    <linearGradient id="rt-antenna" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#334155" />
      <stop offset="50%" stop-color="#1e293b" />
      <stop offset="100%" stop-color="#0f172a" />
    </linearGradient>
    <linearGradient id="rt-cyan" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#38bdf8" />
      <stop offset="100%" stop-color="#00b5e2" />
    </linearGradient>
    <filter id="rt-shadow" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="0" dy="20" stdDeviation="24" flood-color="#0284c7" flood-opacity="0.22" />
    </filter>
  </defs>

  <!-- Background -->
  <rect width="800" height="600" rx="32" fill="url(#rt-bg)" />

  <!-- Radiating Wireless Signal Waves (WiFi 6 GHz Waves) -->
  <g fill="none" stroke="#00b5e2" stroke-width="2.5" opacity="0.35">
    <path d="M340 180 C375 140 425 140 460 180" />
    <path d="M310 150 C365 95 435 95 490 150" stroke-width="3" opacity="0.45" />
    <path d="M280 120 C355 50 445 50 520 120" stroke-width="3.5" opacity="0.25" />
  </g>

  <!-- Ambient Ground Shadow -->
  <ellipse cx="400" cy="495" rx="300" ry="34" fill="#0f172a" opacity="0.25" />

  <!-- 4 High-Gain External Antennas (Stealth Angles) -->
  <!-- Antenna 1 (Far Left: -40°) -->
  <g transform="translate(240 330) rotate(-38)">
    <rect x="-10" y="-220" width="20" height="220" rx="8" fill="url(#rt-antenna)" stroke="#475569" stroke-width="2" />
    <circle cx="0" cy="0" r="14" fill="#0f172a" stroke="#334155" stroke-width="3" />
    <rect x="-6" y="-200" width="12" height="6" fill="#00b5e2" />
  </g>

  <!-- Antenna 2 (Inner Left: -12°) -->
  <g transform="translate(340 310) rotate(-12)">
    <rect x="-10" y="-235" width="20" height="235" rx="8" fill="url(#rt-antenna)" stroke="#475569" stroke-width="2" />
    <circle cx="0" cy="0" r="14" fill="#0f172a" stroke="#334155" stroke-width="3" />
    <rect x="-6" y="-215" width="12" height="6" fill="#00b5e2" />
  </g>

  <!-- Antenna 3 (Inner Right: +12°) -->
  <g transform="translate(460 310) rotate(12)">
    <rect x="-10" y="-235" width="20" height="235" rx="8" fill="url(#rt-antenna)" stroke="#475569" stroke-width="2" />
    <circle cx="0" cy="0" r="14" fill="#0f172a" stroke="#334155" stroke-width="3" />
    <rect x="-6" y="-215" width="12" height="6" fill="#00b5e2" />
  </g>

  <!-- Antenna 4 (Far Right: +40°) -->
  <g transform="translate(560 330) rotate(38)">
    <rect x="-10" y="-220" width="20" height="220" rx="8" fill="url(#rt-antenna)" stroke="#475569" stroke-width="2" />
    <circle cx="0" cy="0" r="14" fill="#0f172a" stroke="#334155" stroke-width="3" />
    <rect x="-6" y="-200" width="12" height="6" fill="#00b5e2" />
  </g>

  <!-- Main Router Chassis (Aggressive Geometric Stealth Design) -->
  <g filter="url(#rt-shadow)">
    <!-- Main Body Upper Deck -->
    <path d="M160 380 L230 310 L570 310 L640 380 L610 450 L190 450 Z" fill="url(#rt-body)" stroke="#334155" stroke-width="3" />

    <!-- Center Glossy Piano-Black Feature Inset Stripe -->
    <polygon points="340,310 460,310 470,450 330,450" fill="#020617" stroke="#00b5e2" stroke-width="1.5" />

    <!-- Geometric Honeycomb Heat Exhaust Ventilation Grilles -->
    <g fill="#020617" opacity="0.8">
      <rect x="220" y="340" width="90" height="8" rx="3" />
      <rect x="210" y="355" width="100" height="8" rx="3" />
      <rect x="200" y="370" width="110" height="8" rx="3" />
      <rect x="490" y="340" width="90" height="8" rx="3" />
      <rect x="490" y="355" width="100" height="8" rx="3" />
      <rect x="490" y="370" width="110" height="8" rx="3" />
    </g>

    <!-- Front Beveled Chin -->
    <path d="M190 450 L210 475 L590 475 L610 450 Z" fill="#090d16" stroke="#1e293b" stroke-width="2" />

    <!-- Front Luminous Status LED Array (Vivid Cyan & Emerald Bars) -->
    <g transform="translate(280 462)">
      <!-- Power LED -->
      <rect x="0" y="0" width="14" height="4" rx="2" fill="#22c55e" />
      <circle cx="7" cy="-8" r="1.5" fill="#86efac" />
      <!-- Internet / WAN LED -->
      <rect x="30" y="0" width="14" height="4" rx="2" fill="#00b5e2" />
      <!-- 2.4 GHz WiFi LED -->
      <rect x="60" y="0" width="14" height="4" rx="2" fill="#00b5e2" />
      <!-- 5 GHz WiFi LED -->
      <rect x="90" y="0" width="14" height="4" rx="2" fill="#00b5e2" />
      <!-- 6 GHz WiFi-6E LED -->
      <rect x="120" y="0" width="14" height="4" rx="2" fill="#38bdf8" />
      <!-- LAN Ports 1 - 4 -->
      <rect x="150" y="0" width="14" height="4" rx="2" fill="#22c55e" />
      <rect x="175" y="0" width="14" height="4" rx="2" fill="#22c55e" />
      <rect x="200" y="0" width="14" height="4" rx="2" fill="#22c55e" />
      <rect x="225" y="0" width="14" height="4" rx="2" fill="#64748b" opacity="0.4" />
    </g>

    <!-- WiFi 6 Emblem on Center Plate -->
    <text x="400" y="370" font-family="sans-serif" font-size="14" font-weight="900" fill="#38bdf8" text-anchor="middle" letter-spacing="1">Wi-Fi 6</text>
    <text x="400" y="388" font-family="sans-serif" font-size="8" font-weight="bold" fill="#94a3b8" text-anchor="middle">AX5400 GIGABIT</text>
  </g>
</svg>`;

// 7. TELEVISION (Ultra-Thin 4K UHD Smart Display with IEEE INSAT Signature Screen Artwork)
const televisionSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" role="img" aria-label="Ultra-thin 4K smart television display with vibrant digital screen">
  <defs>
    <linearGradient id="tv-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#faf5ff" />
      <stop offset="50%" stop-color="#f3e8ff" />
      <stop offset="100%" stop-color="#ede9fe" />
    </linearGradient>
    <linearGradient id="tv-screen" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#002855" />
      <stop offset="40%" stop-color="#00629b" />
      <stop offset="70%" stop-color="#00b5e2" />
      <stop offset="100%" stop-color="#981d97" />
    </linearGradient>
    <linearGradient id="tv-stand" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#cbd5e1" />
      <stop offset="50%" stop-color="#94a3b8" />
      <stop offset="100%" stop-color="#475569" />
    </linearGradient>
    <linearGradient id="tv-bezel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#334155" />
      <stop offset="100%" stop-color="#0f172a" />
    </linearGradient>
    <filter id="tv-shadow" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="0" dy="24" stdDeviation="28" flood-color="#002855" flood-opacity="0.25" />
    </filter>
  </defs>

  <!-- Canvas Background -->
  <rect width="800" height="600" rx="32" fill="url(#tv-bg)" />

  <!-- Ambient Light Reflection on Desk -->
  <ellipse cx="400" cy="505" rx="310" ry="34" fill="#002855" opacity="0.18" />
  <ellipse cx="400" cy="495" rx="240" ry="16" fill="#00b5e2" opacity="0.15" />

  <!-- Sleek Brushed Aluminum Blade Stand Legs -->
  <!-- Left Leg -->
  <polygon points="230,470 200,505 235,505 250,470" fill="url(#tv-stand)" />
  <!-- Right Leg -->
  <polygon points="570,470 600,505 565,505 550,470" fill="url(#tv-stand)" />

  <!-- Main Television Assembly -->
  <g filter="url(#tv-shadow)">
    <!-- Ultra-Slim Outer Bezel Chassis -->
    <rect x="110" y="110" width="580" height="360" rx="14" fill="url(#tv-bezel)" stroke="#64748b" stroke-width="2.5" />

    <!-- Borderless Edge-to-Edge OLED Display Panel -->
    <rect x="120" y="120" width="560" height="340" rx="8" fill="url(#tv-screen)" />

    <!-- On-Screen Graphic Artwork: Vibrant IEEE INSAT Energy Wave -->
    <g opacity="0.9">
      <!-- Wave 1 (Deep IEEE Blue) -->
      <path d="M120 320 C240 240 340 380 480 280 C580 200 640 260 680 220 L680 460 L120 460 Z" fill="#002855" opacity="0.6" />
      <!-- Wave 2 (Electric Cyan) -->
      <path d="M120 360 C260 280 380 420 500 320 C600 240 650 300 680 270 L680 460 L120 460 Z" fill="#00b5e2" opacity="0.4" />
      <!-- Wave 3 (INSAT Signature Violet) -->
      <path d="M120 400 C220 340 340 440 460 370 C560 300 620 380 680 340 L680 460 L120 460 Z" fill="#981d97" opacity="0.5" />

      <!-- Modern On-Screen UI Widgets -->
      <!-- Top Status Bar -->
      <text x="145" y="155" font-family="sans-serif" font-size="14" font-weight="900" fill="#ffffff" letter-spacing="1">IEEE INSAT</text>
      <text x="145" y="172" font-family="sans-serif" font-size="9" font-weight="bold" fill="#67e8f9">CONFERENCE DISPLAY 01</text>
      <text x="655" y="155" font-family="sans-serif" font-size="12" font-weight="bold" fill="#ffffff" text-anchor="end">10:45 AM</text>
      <text x="655" y="170" font-family="sans-serif" font-size="8" font-weight="bold" fill="#86efac" text-anchor="end">● CONNECTED (AIRPLAY / HDMI 1)</text>

      <!-- Center Welcome Presentation Graphic -->
      <g transform="translate(400 270)">
        <circle cx="0" cy="0" r="38" fill="rgba(255,255,255,0.15)" stroke="#ffffff" stroke-width="2" />
        <polygon points="-10,-18 18,0 -10,18" fill="#ffffff" />
        <text x="0" y="58" font-family="sans-serif" font-size="16" font-weight="bold" fill="#ffffff" text-anchor="middle">Ready to Present</text>
        <text x="0" y="74" font-family="sans-serif" font-size="10" font-weight="medium" fill="#e0f2fe" text-anchor="middle">Connect your laptop or select source</text>
      </g>
    </g>

    <!-- Glass Specular Reflection Diagonal Sweep Across Screen -->
    <polygon points="120,120 280,120 180,460 120,460" fill="#ffffff" opacity="0.08" />

    <!-- Bottom Center Bezel IEEE Logo Pip & Power LED -->
    <rect x="390" y="462" width="20" height="4" rx="2" fill="#94a3b8" />
    <circle cx="665" cy="464" r="2.5" fill="#38bdf8" />
  </g>
</svg>`;

// 8. FALLBACK (Multi-Purpose Technical Equipment Flight Case with Foam Protection)
const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" role="img" aria-label="Rugged technical equipment flight case">
  <defs>
    <linearGradient id="fb-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#eff6ff" />
      <stop offset="50%" stop-color="#e0e7ff" />
      <stop offset="100%" stop-color="#c7d2fe" />
    </linearGradient>
    <linearGradient id="fb-case" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#003875" />
      <stop offset="50%" stop-color="#002855" />
      <stop offset="100%" stop-color="#001733" />
    </linearGradient>
    <linearGradient id="fb-latch" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#fef08a" />
      <stop offset="50%" stop-color="#eab308" />
      <stop offset="100%" stop-color="#ca8a04" />
    </linearGradient>
    <filter id="fb-shadow" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="0" dy="22" stdDeviation="24" flood-color="#002855" flood-opacity="0.25" />
    </filter>
  </defs>

  <!-- Background -->
  <rect width="800" height="600" rx="32" fill="url(#fb-bg)" />

  <!-- Ground Shadow -->
  <ellipse cx="400" cy="490" rx="270" ry="34" fill="#002855" opacity="0.22" />

  <!-- Heavy Duty Flight Case -->
  <g filter="url(#fb-shadow)">
    <!-- Main Shell -->
    <rect x="180" y="170" width="440" height="300" rx="32" fill="url(#fb-case)" stroke="#001733" stroke-width="4" />

    <!-- Protective Ribs / Corner Bumpers -->
    <g fill="#001733">
      <!-- Corners -->
      <rect x="180" y="170" width="45" height="45" rx="14" />
      <rect x="575" y="170" width="45" height="45" rx="14" />
      <rect x="180" y="425" width="45" height="45" rx="14" />
      <rect x="575" y="425" width="45" height="45" rx="14" />
      <!-- Ribs -->
      <rect x="290" y="170" width="22" height="300" rx="4" />
      <rect x="390" y="170" width="22" height="300" rx="4" />
      <rect x="490" y="170" width="22" height="300" rx="4" />
    </g>

    <!-- Center Aluminum Valance Seam Line -->
    <rect x="176" y="310" width="448" height="18" fill="#94a3b8" stroke="#475569" stroke-width="2" />

    <!-- Double Heavy Duty Gold Latches -->
    <g transform="translate(260 304)">
      <rect x="-18" y="-12" width="36" height="42" rx="6" fill="#334155" stroke="#1e293b" stroke-width="2" />
      <rect x="-12" y="-6" width="24" height="30" rx="4" fill="url(#fb-latch)" stroke="#854d0e" stroke-width="1.5" />
    </g>
    <g transform="translate(540 304)">
      <rect x="-18" y="-12" width="36" height="42" rx="6" fill="#334155" stroke="#1e293b" stroke-width="2" />
      <rect x="-12" y="-6" width="24" height="30" rx="4" fill="url(#fb-latch)" stroke="#854d0e" stroke-width="1.5" />
    </g>

    <!-- Ergonomic Heavy Spring-Loaded Handle -->
    <g transform="translate(400 460)">
      <path d="M-60 0 C-60 35 60 35 60 0" stroke="#001733" stroke-width="22" stroke-linecap="round" fill="none" />
      <path d="M-55 2 C-55 30 55 30 55 2" stroke="#475569" stroke-width="14" stroke-linecap="round" fill="none" />
      <rect x="-35" y="14" width="70" height="20" rx="6" fill="#00b5e2" />
    </g>

    <!-- IEEE INSAT Equipment Brand Badge (Center Front) -->
    <rect x="330" y="225" width="140" height="55" rx="10" fill="#0f172a" stroke="#00b5e2" stroke-width="2.5" />
    <text x="400" y="248" font-family="sans-serif" font-size="12" font-weight="900" fill="#00b5e2" text-anchor="middle" letter-spacing="1">IEEE INSAT SB</text>
    <text x="400" y="266" font-family="sans-serif" font-size="8" font-weight="bold" fill="#ffffff" text-anchor="middle">EQUIPMENT ASSET</text>
  </g>
</svg>`;

writeFileSync(resolve(dir, "rallonge.svg"), rallongeSvg, "utf-8");
writeFileSync(resolve(dir, "multiprise.svg"), multipriseSvg, "utf-8");
writeFileSync(resolve(dir, "projecteur.svg"), projecteurSvg, "utf-8");
writeFileSync(resolve(dir, "hdmi.svg"), hdmiSvg, "utf-8");
writeFileSync(resolve(dir, "pointeur.svg"), pointeurSvg, "utf-8");
writeFileSync(resolve(dir, "routeur.svg"), routeurSvg, "utf-8");
writeFileSync(resolve(dir, "television.svg"), televisionSvg, "utf-8");
writeFileSync(resolve(dir, "fallback.svg"), fallbackSvg, "utf-8");

console.log("Successfully generated all 8 diversified, high-end equipment vector illustrations!");
