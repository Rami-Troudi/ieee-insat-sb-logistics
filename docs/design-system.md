# IEEE INSAT SB Equipment Reservations — Design System Specification

## 1. Brand Identity & Principles

The visual identity of **IEEE INSAT SB Equipment Reservations** represents an engineering utility:
$$\text{IEEE} + \text{IEEE INSAT Student Branch} + \text{Modern Engineering Utility}$$

### Desired Characteristics

- **Technical & Precise**: Functional, clean, and data-dense without clutter.
- **Young & Modern**: Contemporary typography and subtle accents, avoiding both generic SaaS templates and corporate fatigue.
- **Recognizably IEEE**: Grounded in official IEEE Blue and Navy, adhering to IEEE Master Brand compliance rules.

### IEEE Identity Governance

- **No distortions**: The IEEE Master Brand emblem is rendered strictly with preserved aspect ratios.
- **Color compliance**: Only official IEEE Master Brand treatments (White on dark surfaces, Black / IEEE Blue on light surfaces) are permitted.
- **No decorative effects**: Zero gradients, shadows, borders, or arbitrary recoloring on the IEEE mark itself.
- **Asset path**: Located at `public/assets/ieee_mb_wh.png` and `src/assets/ieee_mb_wh.png`.

---

## 2. Color System & Semantic Tokens

All color values are centralized in `src/styles/tokens.css` and exposed via Tailwind CSS variables in `tailwind.config.js`.

### Core Brand Tokens

| Token Name       | Hex Code  | Purpose / Usage                                                                                                 |
| :--------------- | :-------- | :-------------------------------------------------------------------------------------------------------------- |
| `--ieee-blue`    | `#00629B` | Primary interactive color, default buttons, links, active navigation tabs, approved states, focus rings.        |
| `--ieee-navy`    | `#002855` | Board operational sidebar, primary headers, camera/scanner surface backgrounds, dark mode surfaces.             |
| `--ieee-cyan`    | `#00B5E2` | Scanner viewfinder/reticle, live scanning laser line, availability accents, returning-today calendar indicator. |
| `--insat-violet` | `#981D97` | INSAT signature accent; used strictly and sparingly for "Currently Borrowed" status and active loans.           |

### Neutral Palette

| Token Name             | Hex Code  | Application                                          |
| :--------------------- | :-------- | :--------------------------------------------------- |
| `--background`         | `#F6F8FB` | Main application canvas / body background            |
| `--surface` / `--card` | `#FFFFFF` | Primary card, modal, and container background        |
| `--surface-subtle`     | `#EEF3F6` | Secondary panels, data-table headers, subdued badges |
| `--text-primary`       | `#172A3A` | High-contrast body text and card titles              |
| `--text-secondary`     | `#667085` | Secondary descriptions, timestamps, metadata         |
| `--text-muted`         | `#98A2B3` | Disabled text, placeholders, non-critical icons      |
| `--border`             | `#D9E2E8` | Card borders, table dividers, input borders          |
| `--border-strong`      | `#B8C5CE` | Focused inputs, prominent container boundaries       |

### Semantic State Colors

| Token Name                | Hex Code  | Reservation / System State                                    |
| :------------------------ | :-------- | :------------------------------------------------------------ |
| `--info` / `--brand-blue` | `#00629B` | `APPROVED` — Approved reservation ready for pickup            |
| `--brand-violet`          | `#981D97` | `BORROWED` — Currently checked out / in possession            |
| `--success`               | `#00843D` | `RETURNED` / `COMPLETED` — Returned in good order             |
| `--warning`               | `#D97706` | Warning alerts, near-due notifications                        |
| `--danger`                | `#BA0C2F` | `OVERDUE` — Overdue loans, error dialogs, destructive actions |
| `--text-muted`            | `#98A2B3` | `CANCELLED` — Revoked or cancelled reservations               |
| Slate / Neutral           | `#667085` | `PENDING` — Awaiting Board review                             |

### Signature Gradient (INSAT Accent)

```css
--insat-gradient: linear-gradient(135deg, #00629b 0%, #00b5e2 50%, #981d97 100%);
```

_Rule of Restraint_: Used exclusively as a 4px accent line atop authentication cards, scanner decorative headers, and empty-state iconography. It is strictly forbidden from being applied to full page backgrounds, text, or primary action buttons.

---

## 3. Typography & Hierarchy

The application standardizes on **Open Sans** across all desktop and mobile interfaces with system sans-serif fallbacks.

| Style Role             | Font Size / Line Height | Weight         | Application                                             |
| :--------------------- | :---------------------- | :------------- | :------------------------------------------------------ |
| **Page Title (H1)**    | 32px / 40px             | 700 (Bold)     | Dashboard greetings, Catalogue header, Scan view header |
| **Section Title (H2)** | 24px / 32px             | 600 (Semibold) | Table section titles, Modal headings, Grouped views     |
| **Card Title (H3)**    | 18px / 26px             | 600 (Semibold) | Equipment card names, summary metric cards              |
| **Body (Default)**     | 15px / 22px             | 400 (Regular)  | General body text, form descriptions                    |
| **Body Strong**        | 15px / 22px             | 600 (Semibold) | Emphasized metadata, user labels                        |
| **Small**              | 13px / 18px             | 400 (Regular)  | Timestamps, secondary chapter tags, table helper text   |
| **Label / Eyebrow**    | 12px / 16px             | 600 (Semibold) | Uppercase category pills, field labels, status tags     |

---

## 4. Spacing, Geometry & Elevation

### Spacing Scale (4px Base)

Standardized padding and margins: `4px` (`p-1`), `8px` (`p-2`), `12px` (`p-3`), `16px` (`p-4`), `20px` (`p-5`), `24px` (`p-6`), `32px` (`p-8`), `48px` (`p-12`), `64px` (`p-16`).

- **Mobile Container Padding**: 16px (`px-4`)
- **Tablet Container Padding**: 24px (`px-6`)
- **Desktop Container Padding**: 32px (`px-8`)

### Border Radius

- **Small Controls / Tags**: `8px` (`rounded-md` / `rounded-lg`)
- **Inputs & Buttons**: `10px` (`rounded-10`)
- **Cards & Data Panels**: `14px` (`rounded-14`)
- **Large Modals & Scanner Windows**: `18px` (`rounded-18`)
- **Pills, Badges & Avatars**: `999px` (`rounded-full`)

### Elevation & Shadows

The UI relies primarily on surface contrast (`#FFFFFF` on `#F6F8FB`) with subtle `1px` borders (`#D9E2E8`).

- **Cards**: `border border-border shadow-xs`
- **Modals / Dropdowns**: `border border-border shadow-md`
- **Scanner Viewfinder**: `shadow-2xl` with dark IEEE Navy backdrop

---

## 5. Component Implementations

### Navigation Architecture

- **Member Header (`TopBar`)**: Compact 56px height, displaying the IEEE INSAT brand, active chapter/role pill, reservation link, cart trigger with live badge counter, and user profile drawer.
- **Board Sidebar (`DesktopSidebar`)**:
  - Background: IEEE Navy (`#002855`).
  - Brand: Official white IEEE Master Brand logo + "IEEE INSAT Equipment".
  - Active Item: High-contrast white text over translucent white pill (`rgba(255, 255, 255, 0.12)`).
  - Navigation links: Dashboard, Calendar, Reservations, Inventory, Scan, People, Chapters, Settings.
- **Mobile Bottom Navigation**: Visible on mobile screens under `md:hidden`, providing 48px touch targets for instantaneous route switching.

### Equipment Catalogue Card

- **Aspect Ratio**: 4:3 image framing with graceful fallback hardware icons.
- **Temporal Availability Pill**: Live indicator based on the user's selected From/To date-time window.
- **Quantity Selector**: Stepper controls (`+` / `-`) disabled when requested quantity exceeds available inventory.
- **Add to Cart CTA**: IEEE Blue button with accessible "Select item" label.

### Shared Date/Time Window Selector

- Unified component across Catalogue, Selection, and Board views.
- Supports quick presets (Today, 24 Hours, 3 Days, 1 Week).
- Enforces chronological validation (start time strictly preceding end time).

### Board QR Scanner Experience

- **Surface**: Immersive IEEE Navy (`#002855`) backdrop with darkened surrounding mask.
- **Targeting Reticle**: IEEE Cyan (`#00B5E2`) corner brackets and animated vertical scanning laser beam.
- **Feedback**: Audio beep feedback and haptic vibration upon successful token decoding.
- **Actions**: Instantaneous quick check-out and check-in confirmation sheets with asset status summary.

### Interactive Calendar

- **Views**: Week (default operational view), Month, and Day.
- **Palette Mapping**:
  - `APPROVED`: IEEE Blue (`#00629B`)
  - `BORROWED`: INSAT Violet (`#981D97`)
  - `RETURNING / DUE TODAY`: IEEE Cyan (`#00B5E2`)
  - `OVERDUE`: Danger Red (`#BA0C2F`)
- **Accessibility**: Event popover displaying borrower, items, chapters, and exact loan intervals upon click or focus.

---

## 6. Accessibility & Operational Rules

1. **Touch Targets**: All interactive elements (buttons, inputs, bottom navigation links, steppers) enforce a minimum bounding box of 44×44px (`min-h-[44px]` and `min-w-[44px]`).
2. **Color Contrast**: All text satisfies WCAG AA guidelines (minimum 4.5:1 contrast against surface backgrounds).
3. **Motion**: Honors `prefers-reduced-motion: reduce` by disabling non-essential transitions and pulsing animations.
4. **Keyboard Traversal**: Clear 2px IEEE Blue focus rings (`ring-2 ring-primary ring-offset-2`) applied to all focusable primitives.
