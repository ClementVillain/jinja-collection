// Texte de l'app en Roboto : choisit le fichier de la bonne graisse (Regular, Medium, Bold)
// d'après fontWeight. Les kanji, absents de Roboto, passent par la police japonaise d'iOS.
import { StyleSheet, Text as RNText } from 'react-native';

export function robotoFace(weight) {
  const w = weight === 'bold' ? 700 : parseInt(weight || '400', 10);
  return w >= 700 ? 'Roboto-Bold' : w >= 500 ? 'Roboto-Medium' : 'Roboto-Regular';
}

export const roboto = (style) => [style, { fontFamily: robotoFace(StyleSheet.flatten(style)?.fontWeight), fontWeight: undefined }];

export default function Text({ style, ...props }) {
  return <RNText {...props} style={roboto(style)} />;
}
