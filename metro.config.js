const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// The on-device AI models ship as BUNDLED BINARIES: src/core/ml/vision/segModelManager.ts
// does require('../../../../assets/<model>.tflite') so react-native-fast-tflite can
// load them fully offline. Metro only copies a file verbatim when its extension is in
// `assetExts`; otherwise it tries to PARSE it as JavaScript source and the resolve
// fails with "Unable to resolve module ... .tflite" (it lists .ts/.tsx/.js… candidates).
// 'tflite' is not a Metro default, so register it here.
config.resolver.assetExts = [...config.resolver.assetExts, 'tflite'];

module.exports = withNativeWind(config, { input: './global.css' });

