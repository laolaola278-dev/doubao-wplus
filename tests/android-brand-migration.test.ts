import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

const mainActivityPath = 'android/app/src/main/java/com/doubao/wplus/android/MainActivity.kt';
const bridgePath = 'android/app/src/main/java/com/doubao/wplus/android/DoubaoWPlusBridge.kt';

describe('Android brand migration', () => {
  it('uses the Doubao WPlus package and class layout', () => {
    expect(existsSync(mainActivityPath)).toBe(true);
    expect(existsSync(bridgePath)).toBe(true);
    // backward compat: old brand — assert the retired package paths stay removed.
    expect(existsSync('android/app/src/main/java/com/deepseekpp/android/MainActivity.kt')).toBe(false);
    expect(existsSync('android/app/src/main/java/com/deepseekpp/android/DeepSeekPlusPlusBridge.kt')).toBe(false);

    expect(read(mainActivityPath)).toContain('package com.doubao.wplus.android');
    expect(read(mainActivityPath)).toContain('DoubaoWPlusBridge');
    expect(read(bridgePath)).toContain('class DoubaoWPlusBridge');
  });

  it('uses current Android identifiers and asset paths', () => {
    const mainActivity = read(mainActivityPath);
    const gradle = read('android/app/build.gradle.kts');
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    const theme = read('android/app/src/main/res/values/themes.xml');
    const strings = read('android/app/src/main/res/values/strings.xml');
    const staging = read('scripts/copy-to-android-assets.mjs');
    const shim = read('android/web/android-bridge-shim.js');

    expect(gradle).toContain('namespace = "com.doubao.wplus.android"');
    expect(gradle).toContain('applicationId = "com.doubao.wplus.android"');
    expect(manifest).toContain('@style/Theme.DoubaoWPlus');
    expect(theme).toContain('name="Theme.DoubaoWPlus"');
    expect(strings).toContain('<string name="app_name">Doubao WPlus</string>');
    expect(strings).toContain('<string name="deepseek_url">https://chat.deepseek.com/</string>');
    expect(staging).toContain("android/app/src/main/assets/dwplus");
    expect(shim).toContain('id: "doubao-wplus-android"');

    // DeepSeek host compatibility is not part of the retired product brand.
    expect(mainActivity).toContain('private const val DEEPSEEK_ORIGIN = "https://chat.deepseek.com"');
    expect(mainActivity).toContain('webChromeClient = deepSeekChromeClient()');
    expect(mainActivity).toContain('webViewClient = deepSeekWebViewClient()');
    expect(mainActivity).toContain('getString(R.string.deepseek_url)');
  });

  it('keeps deprecated preference identifiers only for one-time migration', () => {
    const bridge = read(bridgePath);

    expect(bridge).toContain('CURRENT_PREFS_NAME = "doubao_wplus_android"');
    expect(bridge).toContain('CURRENT_THEME_KEY = "doubao_wplus_theme"');
    // backward compat: old brand — retained only as one-time preference migration inputs.
    expect(bridge).toContain('DEPRECATED_PREFS_NAME = "deepseek_pp_android"');
    expect(bridge).toContain('DEPRECATED_THEME_KEY = "deepseek_pp_theme"');
    expect(bridge).toContain('migrateDeprecatedPreferences()');
    expect(bridge).toContain('val legacyValues = legacyPrefs.all');
    expect(bridge).toContain('if (!editor.commit()) return');
    expect(bridge).toContain('legacyPrefs.edit().clear().commit()');
  });
});
