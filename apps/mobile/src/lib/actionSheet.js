// Menu de choix commun aux deux systèmes, même usage qu'ActionSheetIOS (réservé à iOS).
// Sur Android, c'est une boîte de dialogue : elle affiche au plus 3 boutons, donc avec 3 choix
// « Annuler » disparaît et on ferme en touchant à côté.
import { ActionSheetIOS, Alert, Platform } from 'react-native';

export function showActionSheet({ title, options, cancelButtonIndex, destructiveButtonIndex }, onChoice) {
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions({ title, options, cancelButtonIndex, destructiveButtonIndex }, onChoice);
    return;
  }
  const choices = options.map((text, i) => ({ text, onPress: () => onChoice(i) })).filter((_, i) => i !== cancelButtonIndex);
  const buttons = choices.length < 3 ? [{ text: options[cancelButtonIndex], style: 'cancel' }, ...choices] : choices;
  Alert.alert(title, undefined, buttons, { cancelable: true });
}
