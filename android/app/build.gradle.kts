plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.doubao.wplus.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.doubao.wplus.android"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.6.5"
    }
}
