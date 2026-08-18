const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// The on-device AI models ship as BUNDLED BINARIES: src/core/ml/vision/segModelManager.ts
// does require('../../../../assets/<model>.tflite') so react-native-fast-tflite can
// load them fully offline. Metro only copies a file verbatim when its extension is in
// `assetExts`; otherwise it tries to PARSE it as JavaScript source and the resolve
// fails with "Unable to resolve module ... .tflite" (it lists .ts/.tsx/.js… candidates).
// 'tflite' is not a Metro default, so register it here.
config.resolver.assetExts = [...config.resolver.assetExts, 'tflite',
  // QA controlled-image set (app/mldiag.tsx): a .jpg require() becomes an
  // Android res/ DRAWABLE in release — no file:// URI, so FileSystem/Skia
  // cannot read it. The '.jpgbin' copies ship as verbatim file assets and
  // expo-asset downloadAsync() yields a real file:// path (same mechanism,
  // and same reason, as the .tflite models above).
  'jpgbin'];

module.exports = withNativeWind(config, { input: './global.css' });

