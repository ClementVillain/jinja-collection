// Texte de l'app en Lato : choisit le fichier de la bonne graisse (Regular ou Bold ; Lato n'a
// pas de « Medium », 600 et plus passent en gras) d'après fontWeight. Les kanji, absents de Lato,
// passent par la police japonaise d'iOS.
import { StyleSheet, Text as RNText } from 'react-native';

export function fontFace(weight) {
  const w = weight === 'bold' ? 700 : parseInt(weight || '400', 10);
  return w >= 600 ? 'Lato-Bold' : 'Lato-Regular';
}

export const withFont = (style) => [style, { fontFamily: fontFace(StyleSheet.flatten(style)?.fontWeight), fontWeight: undefined }];

export default function Text({ style, ...props }) {
  return <RNText {...props} style={withFont(style)} />;
}
