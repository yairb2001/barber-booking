// ─── Admin App — WebView wrapper ──────────────────────────────────────────────
// Loads the full web admin inside a native shell.
// All features of the web admin are available instantly.

import React, { useRef, useState } from "react";
import {
  View,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  Text,
  Platform,
} from "react-native";
import { WebView } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

const ADMIN_URL = "https://barber-booking-indol.vercel.app/admin";

export default function AdminWebView() {
  const webRef = useRef<WebView>(null);
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" backgroundColor="#0A0A0A" />

      {/* Slim top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => webRef.current?.goBack()} style={styles.navBtn}>
          <Text style={styles.navText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.barTitle}>✂️ Dominant Admin</Text>
        <TouchableOpacity onPress={() => webRef.current?.reload()} style={styles.navBtn}>
          <Text style={styles.navText}>↻</Text>
        </TouchableOpacity>
      </View>

      {/* WebView */}
      <WebView
        ref={webRef}
        source={{ uri: ADMIN_URL }}
        style={styles.webview}
        onLoadStart={() => { setLoading(true); setError(false); }}
        onLoadEnd={() => setLoading(false)}
        onError={() => { setLoading(false); setError(true); }}
        allowsBackForwardNavigationGestures
        pullToRefreshEnabled
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        scalesPageToFit={false}
        injectedJavaScript={`
          (function() {
            var meta = document.querySelector('meta[name="viewport"]');
            if (!meta) {
              meta = document.createElement('meta');
              meta.name = 'viewport';
              document.head.appendChild(meta);
            }
            meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
          })();
          true;
        `}
        userAgent={
          Platform.OS === "ios"
            ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 DominantAdminApp/1.0"
            : "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 DominantAdminApp/1.0"
        }
      />

      {/* Loading overlay */}
      {loading && (
        <View style={styles.loadingOverlay}>
          <Text style={styles.loadingEmoji}>✂️</Text>
          <ActivityIndicator color="#D4AF37" size="large" style={{ marginTop: 16 }} />
          <Text style={styles.loadingText}>טוען...</Text>
        </View>
      )}

      {/* Error screen */}
      {error && (
        <View style={styles.errorScreen}>
          <Text style={styles.errorEmoji}>📡</Text>
          <Text style={styles.errorTitle}>אין חיבור</Text>
          <Text style={styles.errorSub}>בדוק חיבור לאינטרנט</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => webRef.current?.reload()}
          >
            <Text style={styles.retryText}>נסה שוב</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0A0A" },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#0A0A0A",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(212,175,55,0.2)",
  },
  navBtn:   { padding: 8, minWidth: 36, alignItems: "center" },
  navText:  { color: "#D4AF37", fontSize: 24, fontWeight: "300" },
  barTitle: { color: "#F5F0E1", fontSize: 15, fontWeight: "700" },

  webview: { flex: 1 },

  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#0A0A0A",
    justifyContent: "center",
    alignItems: "center",
    top: 44, // below top bar
  },
  loadingEmoji: { fontSize: 52 },
  loadingText:  { color: "#A8A099", marginTop: 12, fontSize: 15 },

  errorScreen: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#0A0A0A",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    top: 44,
  },
  errorEmoji: { fontSize: 52 },
  errorTitle: { color: "#F5F0E1", fontSize: 22, fontWeight: "700" },
  errorSub:   { color: "#6B6359", fontSize: 15 },
  retryBtn: {
    marginTop: 8,
    backgroundColor: "#D4AF37",
    borderRadius: 14,
    paddingHorizontal: 28,
    paddingVertical: 12,
  },
  retryText: { color: "#0A0A0A", fontWeight: "700", fontSize: 16 },
});
