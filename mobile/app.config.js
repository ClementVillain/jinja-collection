// Configuration dynamique : la connexion Google sur iPhone nécessite un « ID client iOS »
// (Google Cloud Console). Tant qu'il n'est pas fourni, l'app se construit sans le module
// de connexion configuré et masque le bouton.
//   GOOGLE_IOS_CLIENT_ID=xxx.apps.googleusercontent.com npx expo run:ios --device
module.exports = ({ config }) => {
  const iosClientId = process.env.GOOGLE_IOS_CLIENT_ID || '';
  const plugins = [...(config.plugins || [])];
  if (iosClientId) {
    // Schéma d'URL de retour attendu par Google : l'ID client à l'envers.
    const iosUrlScheme = `com.googleusercontent.apps.${iosClientId.replace('.apps.googleusercontent.com', '')}`;
    plugins.push(['@react-native-google-signin/google-signin', { iosUrlScheme }]);
  }
  return { ...config, plugins, extra: { ...config.extra, googleIosClientId: iosClientId } };
};
