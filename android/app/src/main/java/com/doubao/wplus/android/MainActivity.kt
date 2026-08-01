package com.doubao.wplus.android

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var bridge: DoubaoWPlusBridge
    private var pendingFileChooser: ValueCallback<Array<Uri>>? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        bridge = DoubaoWPlusBridge(applicationContext)
        CookieManager.getInstance().setAcceptCookie(true)

        webView = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            addJavascriptInterface(bridge, "AndroidBridge")
            webChromeClient = deepSeekChromeClient()
            webViewClient = deepSeekWebViewClient()
        }

        setContentView(webView)
        webView.loadUrl(intent?.data?.toString()?.takeIf { it.startsWith(DEEPSEEK_ORIGIN) }
            ?: getString(R.string.deepseek_url))
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val url = intent.data?.toString() ?: return
        if (url.startsWith(DEEPSEEK_ORIGIN)) webView.loadUrl(url)
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
            return
        }
        @Suppress("DEPRECATION")
        super.onBackPressed()
    }

    override fun onDestroy() {
        pendingFileChooser?.onReceiveValue(null)
        pendingFileChooser = null
        webView.removeJavascriptInterface("AndroidBridge")
        webView.destroy()
        super.onDestroy()
    }

    @Deprecated("Activity result kept minimal until Android picker abstraction lands.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_FILE_CHOOSER) return
        val callback = pendingFileChooser ?: return
        pendingFileChooser = null
        callback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
    }

    private fun deepSeekChromeClient() = object : WebChromeClient() {
        override fun onShowFileChooser(
            view: WebView?,
            filePathCallback: ValueCallback<Array<Uri>>?,
            fileChooserParams: FileChooserParams?,
        ): Boolean {
            pendingFileChooser?.onReceiveValue(null)
            pendingFileChooser = filePathCallback
            return try {
                val intent = fileChooserParams?.createIntent()
                if (intent == null) {
                    pendingFileChooser = null
                    return false
                }
                startActivityForResult(intent, REQUEST_FILE_CHOOSER)
                true
            } catch (error: Throwable) {
                pendingFileChooser = null
                Log.w(TAG, "file chooser failed", error)
                false
            }
        }
    }

    private fun deepSeekWebViewClient() = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
            val url = request?.url?.toString() ?: return false
            if (url.startsWith(DEEPSEEK_ORIGIN)) return false
            return try {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                true
            } catch (error: Throwable) {
                Log.w(TAG, "external navigation failed: $url", error)
                false
            }
        }

        override fun onPageFinished(view: WebView?, url: String?) {
            super.onPageFinished(view, url)
            if (url?.startsWith(DEEPSEEK_ORIGIN) != true) return
            injectDoubaoWPlusBundle()
        }
    }

    private fun injectDoubaoWPlusBundle() {
        injectAsset("android-bridge-shim.js")
        injectAsset("content-scripts/main-world.js")
        injectAsset("content-scripts/content.js")
    }

    private fun injectAsset(path: String) {
        try {
            val script = assets.open("dwplus/$path").bufferedReader().use { it.readText() }
            webView.evaluateJavascript("$script\n//# sourceURL=android_asset/dwplus/$path", null)
        } catch (error: Throwable) {
            Log.w(TAG, "missing or invalid asset: $path", error)
        }
    }

    companion object {
        private const val TAG = "DoubaoWPlus"
        private const val REQUEST_FILE_CHOOSER = 4201
        private const val DEEPSEEK_ORIGIN = "https://chat.deepseek.com"
    }
}
