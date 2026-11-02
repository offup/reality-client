import type { SVGProps } from "react";

// Paket/Würfel im Stil der ticklog-Icons (abgerundetes Sechseck, Deckelnaht, Etikett).
// Nachgezeichnet aus dem "Design Lab"-Kit, kein Original-Pfad.
function PackageBox({ size = 24, strokeWidth = 2, ...rest }: SVGProps<SVGSVGElement> & { size?: number }) {
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
      {/* Außenform: Sechseck mit Spitze oben/unten, Ecken abgerundet */}
      <path d="M10.9 3.4 Q12 2.8 13.1 3.4 L19.2 6.85 Q20.3 7.5 20.3 8.75 L20.3 15.25 Q20.3 16.5 19.2 17.15 L13.1 20.6 Q12 21.2 10.9 20.6 L4.8 17.15 Q3.7 16.5 3.7 15.25 L3.7 8.75 Q3.7 7.5 4.8 6.85Z" />
      {/* Kanten der Oberseite und Vorderkante */}
      <path d="M4 7.5 12 12 20 7.5" />
      <path d="M12 12v9" />
      {/* Deckelnaht */}
      <path d="m8 5.2 8 4.5" />
      {/* Etikett auf der linken Seite */}
      <path d="m6.6 11.3 2.4 1.35" />
    </svg>
  );
}

export default PackageBox;
