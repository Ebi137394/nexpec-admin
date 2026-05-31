// ════════════════════════════════════════════════════════════════════════════
//  src/core/ml/vision/preprocess.ts — image → normalized Float32 tensor (on-device)
//
//  Solves the RN "image → pixels → tensor" gap with ZERO API cost:
//    1. expo-image-manipulator (already installed) resizes to the model input.
//    2. @shopify/react-native-skia decodes the resized image and readPixels()
//       gives raw RGBA bytes.
//    3. Pure-JS normalization produces an NHWC / NCHW Float32Array.
//
//  Skia is require-guarded so this file type-checks before the dep is installed
//  and is only ever evaluated inside the dynamically-imported vision chunk
//  (so Expo Go, which lacks the Skia native module, is never affected).
// ════════════════════════════════════════════════════════════════════════════

import * as ImageManipulator from 'expo-image-manipulator';

export interface VisionInputSpec {
  width?: number;
  height?: number;
  layout?: 'NHWC' | 'NCHW';
  /** Either mean/std (ImageNet-style) OR scale/offset (e.g. MobileNet [-1,1]). */
  normalize?: { mean?: number[]; std?: number[]; scale?: number; offset?: number };
}
export interface VisionParams {
  input?: VisionInputSpec;
  [k: string]: unknown;
}

export interface PreprocessResult {
  data: Float32Array;
  width: number;
  height: number;
}

// Require-guarded native dependency. Loaded lazily; `any` until the package is
// installed in a dev build (then its real API is used at runtime).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _skia: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  _skia = require('@shopify/react-native-skia');
} catch {
  _skia = null;
}

export function isVisionPreprocessAvailable(): boolean {
  return _skia != null;
}

export async function imageUriToTensor(
  imageUri: string,
  params: VisionParams,
): Promise<PreprocessResult> {
  if (!_skia) {
    throw new Error('@shopify/react-native-skia unavailable — run a dev build with Skia installed');
  }
  const W = params.input?.width ?? 224;
  const H = params.input?.height ?? 224;
  const layout = params.input?.layout ?? 'NHWC';

  // 1) Resize to the model's input dimensions (native, fast, Expo-Go-safe lib).
  const resized = await ImageManipulator.manipulateAsync(
    imageUri,
    [{ resize: { width: W, height: H } }],
    { compress: 1, format: ImageManipulator.SaveFormat.PNG },
  );

  // 2) Decode + read raw RGBA pixels via Skia.
  const Skia = _skia.Skia;
  const data = await Skia.Data.fromURI(resized.uri);
  const img = Skia.Image.MakeImageFromEncoded(data);
  if (!img) throw new Error('Skia could not decode the image');
  const rgba: Uint8Array = img.readPixels(0, 0, {
    width: W,
    height: H,
    colorType: _skia.ColorType.RGBA_8888,
    alphaType: _skia.AlphaType.Unpremul,
  });
  if (!rgba) throw new Error('Skia readPixels returned null');

  // 3) RGBA → normalized Float32 tensor.
  const mean = params.input?.normalize?.mean ?? [0, 0, 0];
  const std = params.input?.normalize?.std ?? [1, 1, 1];
  const scale = params.input?.normalize?.scale;
  const offset = params.input?.normalize?.offset ?? 0;
  const norm = (v: number, c: number): number =>
    scale != null ? v * scale + offset : (v / 255 - mean[c]) / std[c];

  const out = new Float32Array(W * H * 3);
  if (layout === 'NHWC') {
    let o = 0;
    for (let i = 0; i < W * H; i++) {
      const j = i * 4;
      out[o++] = norm(rgba[j], 0);
      out[o++] = norm(rgba[j + 1], 1);
      out[o++] = norm(rgba[j + 2], 2);
    }
  } else {
    const plane = W * H;
    for (let i = 0; i < plane; i++) {
      const j = i * 4;
      out[i] = norm(rgba[j], 0);
      out[plane + i] = norm(rgba[j + 1], 1);
      out[2 * plane + i] = norm(rgba[j + 2], 2);
    }
  }
  return { data: out, width: W, height: H };
}
