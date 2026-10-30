// Metro ne surveille que le dossier de l'app : on lui ajoute packages/shared (code et données
// communs au site), lié dans node_modules/@jinja/shared par npm.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders || []), path.resolve(__dirname, '../../packages/shared')];

module.exports = config;
