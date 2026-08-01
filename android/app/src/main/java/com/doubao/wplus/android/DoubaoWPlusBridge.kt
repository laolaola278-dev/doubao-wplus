package com.doubao.wplus.android

import android.content.Context
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.webkit.JavascriptInterface
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Locale

class DoubaoWPlusBridge(private val context: Context) {
    private val prefs = context.getSharedPreferences(CURRENT_PREFS_NAME, Context.MODE_PRIVATE)

    init {
        migrateDeprecatedPreferences()
    }

    @JavascriptInterface
    fun getStorage(key: String?): String? {
        val safeKey = key?.takeIf { it.isNotBlank() } ?: return null
        return prefs.getString(safeKey, null)
    }

    @JavascriptInterface
    fun setStorage(key: String?, value: String?) {
        val safeKey = key?.takeIf { it.isNotBlank() } ?: return
        prefs.edit().putString(safeKey, value ?: "null").apply()
    }

    @JavascriptInterface
    fun removeStorage(key: String?) {
        val safeKey = key?.takeIf { it.isNotBlank() } ?: return
        prefs.edit().remove(safeKey).apply()
    }

    @JavascriptInterface
    fun getSystemLocale(): String {
        val tag = Locale.getDefault().toLanguageTag()
        return if (tag.isBlank() || tag == "und") "en-US" else tag
    }

    @JavascriptInterface
    fun getAssetUrl(path: String?): String {
        val safePath = normalizeAssetPath(path)
        return "file:///android_asset/dwplus/$safePath"
    }

    @JavascriptInterface
    fun postMessage(payloadJson: String?): String {
        return try {
            val payload = JSONObject(payloadJson ?: "{}")
            when (payload.optString("type")) {
                "GET_MEMORIES",
                "GET_SKILLS",
                "GET_TOOL_DESCRIPTORS" -> JSONArray().toString()
                "GET_ACTIVE_PRESET",
                "GET_MODEL_TYPE",
                "GET_ACTIVE_PROJECT_CONTEXT",
                "GET_BACKGROUND" -> "null"
                "GET_PLATFORM_CAPABILITIES" -> platformEnvironment().toString()
                "GET_PET" -> JSONObject()
                    .put("enabled", false)
                    .put("position", "bottom-right")
                    .put("size", 72)
                    .put("opacity", 1)
                    .put("motion", true)
                    .toString()
                "GET_DEEPSEEK_THEME" -> JSONObject.quote(getStoredJsonString(CURRENT_THEME_KEY, "light"))
                "SET_DEEPSEEK_THEME" -> ok()
                "TOUCH_MEMORIES",
                "AUTH_STATUS_CHANGED" -> ok()
                else -> JSONObject()
                    .put("ok", false)
                    .put("error", "android_background_message_unsupported")
                    .put("type", payload.optString("type"))
                    .toString()
            }
        } catch (error: Throwable) {
            JSONObject()
                .put("ok", false)
                .put("error", error.message ?: "android_bridge_error")
                .toString()
        }
    }

    @JavascriptInterface
    fun downloadBlob(base64: String?, mimeType: String?, filename: String?) {
        val safeName = normalizeDownloadName(filename)
        val bytes = Base64.decode(base64 ?: "", Base64.DEFAULT)
        val file = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), safeName)
        file.parentFile?.mkdirs()
        file.writeBytes(bytes)
        Handler(Looper.getMainLooper()).post {
            Toast.makeText(context, "Saved $safeName", Toast.LENGTH_SHORT).show()
        }
    }

    private fun platformEnvironment(): JSONObject {
        val capabilities = JSONObject()
            .put("storage", true)
            .put("runtimeMessaging", true)
            .put("downloads", true)
            .put("filePicker", false)
            .put("folderPicker", false)
            .put("assetUrl", true)
            .put("sidePanel", false)
            .put("nativeMessaging", false)
            .put("contextMenus", false)
            .put("alarms", false)
        return JSONObject()
            .put("kind", "android_webview")
            .put("name", "Android WebView")
            .put("capabilities", capabilities)
    }

    private fun getStoredJsonString(key: String, fallback: String): String {
        val raw = prefs.getString(key, null) ?: return fallback
        return try {
            val parsed = JSONObject("{\"value\":$raw}")
            parsed.optString("value", fallback)
        } catch (_: Throwable) {
            fallback
        }
    }

    private fun ok(): String = JSONObject().put("ok", true).toString()

    companion object {
        private const val CURRENT_PREFS_NAME = "doubao_wplus_android"
        private const val CURRENT_THEME_KEY = "doubao_wplus_theme"
        // backward compat: old brand — read once while upgrading existing installs.
        private const val DEPRECATED_PREFS_NAME = "deepseek_pp_android"
        private const val DEPRECATED_THEME_KEY = "deepseek_pp_theme"
    }

    private fun normalizeAssetPath(path: String?): String =
        (path ?: "")
            .replace("\\", "/")
            .split("/")
            .filter { it.isNotBlank() && it != "." && it != ".." }
            .joinToString("/")

    private fun migrateDeprecatedPreferences() {
        val legacyPrefs = context.getSharedPreferences(DEPRECATED_PREFS_NAME, Context.MODE_PRIVATE)
        val legacyValues = legacyPrefs.all
        if (legacyValues.isEmpty()) return

        val editor = prefs.edit()
        for ((legacyKey, value) in legacyValues) {
            val currentKey = if (legacyKey == DEPRECATED_THEME_KEY) CURRENT_THEME_KEY else legacyKey
            if (prefs.contains(currentKey)) continue
            when (value) {
                is String -> editor.putString(currentKey, value)
                is Boolean -> editor.putBoolean(currentKey, value)
                is Int -> editor.putInt(currentKey, value)
                is Long -> editor.putLong(currentKey, value)
                is Float -> editor.putFloat(currentKey, value)
                is Set<*> -> editor.putStringSet(currentKey, value.filterIsInstance<String>().toSet())
            }
        }
        if (!editor.commit()) return

        // backward compat: old brand — clear the legacy preference file only after a successful copy.
        legacyPrefs.edit().clear().commit()
    }

    private fun normalizeDownloadName(filename: String?): String {
        val normalized = normalizeAssetPath(filename).ifBlank { "download.bin" }
        return normalized.substringAfterLast('/').take(120).ifBlank { "download.bin" }
    }
}
