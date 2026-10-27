// Configuration dynamique : connexion Google sur iPhone avec l'« ID client iOS » du projet
// Google Cloud du site (même projet que l'ID client web, sinon le serveur refuse le jeton).
// Il n'est pas secret. GOOGLE_IOS_CLIENT_ID permet d'en utiliser un autre, ou '' pour désactiver.
const DEFAULT_IOS_CLIENT_ID = '972771617767-1pb96hsib2li41sp0rfgdfg0eqsrht1t.apps.googleusercontent.com';

module.exports = ({ config }) => {
  const iosClientId = process.env.GOOGLE_IOS_CLIENT_ID ?? DEFAULT_IOS_CLIENT_ID;
  const plugins = [...(config.plugins || [])];
  if (iosClientId) {
    // Schéma d'URL de retour attendu par Google : l'ID client à l'envers.
    const iosUrlScheme = `com.googleusercontent.apps.${iosClientId.replace('.apps.googleusercontent.com', '')}`;
    plugins.push(['@react-native-google-signin/google-signin', { iosUrlScheme }]);
  }
  return { ...config, plugins, extra: { ...config.extra, googleIosClientId: iosClientId } };
};
