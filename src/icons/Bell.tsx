import type { SVGProps } from "react";

// Glocke im Stil der ticklog-Icons: runde Haube, ausgestellter Rand, Klöppel als Bogen.
// Nachgezeichnet aus dem "Design Lab"-Kit, kein Original-Pfad.
function Bell({ size = 24, strokeWidth = 2, ...rest }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d="M6 10.5a6 6 0 0 1 12 0v3.9c0 .7.3 1.3.9 1.7l.6.4c.9.6.5 1.9-.6 1.9H5.1c-1.1 0-1.5-1.3-.6-1.9l.6-.4c.6-.4.9-1 .9-1.7z" />
      <path d="M10 20.5q2 1.4 4 0" />
    </svg>
  );
}

export default Bell;
