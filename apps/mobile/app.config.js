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
  // « Se connecter avec Apple » demande la capacité Sign in with Apple, refusée aux comptes
  // développeur gratuits : on ne l'active qu'avec APPLE_SIGN_IN=1 (compte payant, App Store).
  const appleSignIn = process.env.APPLE_SIGN_IN === '1';
  if (appleSignIn) plugins.push('expo-apple-authentication');
  else {
    // Le module installé ajoute sa capacité automatiquement : on la retire, sinon la signature
    // avec un compte gratuit échoue.
    const { withEntitlementsPlist } = require('expo/config-plugins');
    plugins.push((cfg) => withEntitlementsPlist(cfg, (mod) => {
      delete mod.modResults['com.apple.developer.applesignin'];
      return mod;
    }));
  }
  return {
    ...config,
    ios: { ...config.ios, ...(appleSignIn ? { usesAppleSignIn: true } : {}) },
    plugins,
    extra: { ...config.extra, googleIosClientId: iosClientId, appleSignIn },
  };
};
