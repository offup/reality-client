import type { SVGProps } from "react";

// Abgerundetes Sechseck mit Diagonalstrich, Pfad 1:1 von ticklog.net übernommen.
// Gleiche Attribute wie lucide-react, damit es sich nahtlos einreiht.
function HexagonSlash({ size = 24, strokeWidth = 2, ...rest }: SVGProps<SVGSVGElement> & { size?: number }) {
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
      <path d="M3.38 13.57 Q2.5 12 3.38 10.43 L6.12 5.57 Q7 4 8.8 4 L15.2 4 Q17 4 17.88 5.57 L20.62 10.43 Q21.5 12 20.62 13.57 L17.88 18.43 Q17 20 15.2 20 L8.8 20 Q7 20 6.12 18.43Z" />
      <path d="m9.75 9 4.5 6" />
    </svg>
  );
}

export default HexagonSlash;
