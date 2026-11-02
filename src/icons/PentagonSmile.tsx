import type { SVGProps } from "react";

// Abgerundetes Fünfeck mit Lächeln, Pfad 1:1 von ticklog.net übernommen.
// Gleiche Attribute wie lucide-react, damit es sich nahtlos einreiht.
function PentagonSmile({ size = 24, strokeWidth = 2, ...rest }: SVGProps<SVGSVGElement> & { size?: number }) {
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
      <path d="M9.90 4.53Q12.00 3.00 14.10 4.53L19.03 8.11Q21.13 9.63 20.33 12.11L18.45 17.89Q17.64 20.37 15.04 20.37L8.96 20.37Q6.36 20.37 5.55 17.89L3.67 12.11Q2.87 9.63 4.97 8.11Z" />
      <path d="M10 15.5q2 1.5 4 0" />
    </svg>
  );
}

export default PentagonSmile;
