/**
 * Hand-drawn line icons used in place of emoji glyphs. Each inherits
 * `currentColor` so it themes with its surroundings. Decorative by default;
 * the surrounding control carries the accessible label.
 */
import type { SVGProps } from "react";

const base: SVGProps<SVGSVGElement> = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
};

/** Brand mark: a place pin, for "meet here". */
export function LogoMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.6" />
    </svg>
  );
}

/** Two routes converging on a shared point, for the empty state. */
export function MeetIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <circle cx="5.5" cy="5.5" r="2.2" />
      <circle cx="18.5" cy="5.5" r="2.2" />
      <path d="M5.5 7.7c0 4 2.4 6.1 6.5 8.3 4.1-2.2 6.5-4.3 6.5-8.3" strokeDasharray="0.1 3.2" />
      <path d="M12 14.5a3 3 0 0 0-3 3c0 1.9 3 4 3 4s3-2.1 3-4a3 3 0 0 0-3-3Z" />
    </svg>
  );
}

/** GPS crosshair, for "use my location". */
export function LocateIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="6" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function SunIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8" />
    </svg>
  );
}

export function MoonIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4 7 7 0 1 0 20 14.5Z" />
    </svg>
  );
}
