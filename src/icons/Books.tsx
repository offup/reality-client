import type { SVGProps } from "react";

// Zwei Bücher, das rechte leicht gekippt, im Stil der ticklog-Icons.
// Nachgezeichnet aus dem "Design Lab"-Kit, kein Original-Pfad.
function Books({ size = 24, strokeWidth = 2, ...rest }: SVGProps<SVGSVGElement> & { size?: number }) {
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
      {/* Linkes Buch, aufrecht */}
      <rect x="4.5" y="3.5" width="5.5" height="17" rx="1.6" />
      <path d="M4.5 7.5h5.5" />
      <path d="M7.25 17h.01" />
      {/* Rechtes Buch, um 14° gekippt, steht unten am linken an */}
      <g transform="rotate(14 10.6 20.5)">
        <rect x="10.6" y="3.5" width="5.5" height="17" rx="1.6" />
        <path d="M10.6 7.5h5.5" />
        <path d="M13.35 17h.01" />
      </g>
    </svg>
  );
}

export default Books;
