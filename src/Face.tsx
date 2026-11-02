import "./Face.css";

type Props = {
  /** Skin-Textur (URL oder data:-URL), 64×64 */
  skin: string;
  size?: number;
};

// Gesicht direkt aus der Skin-Textur: Kopf-Vorderseite (8,8) plus Hut-Ebene (40,8)
function Face({ skin, size = 28 }: Props) {
  const scale = size / 8;
  const base = {
    width: size,
    height: size,
    backgroundImage: `url("${skin}")`,
    backgroundSize: `${64 * scale}px ${64 * scale}px`,
  };
  return (
    <span className="face" style={{ ...base, backgroundPosition: `${-8 * scale}px ${-8 * scale}px` }}>
      <span className="face-hat" style={{ ...base, backgroundPosition: `${-40 * scale}px ${-8 * scale}px` }} />
    </span>
  );
}

export default Face;
