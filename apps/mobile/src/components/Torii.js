// Torii monochrome, de la couleur demandée (l'émoji ⛩ s'affiche toujours en rouge).
import { SvgXml } from 'react-native-svg';

const xml = (color) => `<svg viewBox="0 0 24 24"><g fill="${color}"><path d="M1.5 4.2Q12 6.6 22.5 4.2L21.9 7.1Q12 8.9 2.1 7.1Z"/><rect x="3.6" y="10" width="16.8" height="1.9" rx=".4"/><rect x="5.4" y="7.4" width="2.3" height="13.8" rx=".4"/><rect x="16.3" y="7.4" width="2.3" height="13.8" rx=".4"/><rect x="11" y="7.8" width="2" height="2.6"/></g></svg>`;

export default function Torii({ size = 16, color = '#ffffff', style }) {
  return <SvgXml xml={xml(color)} width={size} height={size} style={style} />;
}
