package cz.katka.ctecka;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;

/**
 * Obal kolem webové čtečky: stránky bere z balíčku aplikace (složka assets/www),
 * k síti nemá přístup. Navíc umí projít úložiště a najít PDF (po povolení) a tisknout.
 */
public class MainActivity extends Activity {
    private static final String HOST = "ctecka.app";
    private WebView web;
    private ValueCallback<Uri[]> fileCb;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        web.addJavascriptInterface(new Bridge(), "Android");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
                return serve(req.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                return !HOST.equals(req.getUrl().getHost());
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("application/pdf");
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(Intent.createChooser(i, "Vyber PDF"), 1);
                } catch (Exception e) {
                    fileCb = null;
                    return false;
                }
                return true;
            }
        });
        if (state == null) web.loadUrl("https://" + HOST + "/index.html");
        else web.restoreState(state);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    private static WebResourceResponse status(int code, String text) {
        return new WebResourceResponse("text/plain", "utf-8", code, text, null, new ByteArrayInputStream(new byte[0]));
    }

    private static String mime(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js")) return "application/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".webmanifest")) return "application/manifest+json";
        return "text/plain";
    }

    private WebResourceResponse serve(Uri u) {
        if (!HOST.equals(u.getHost())) return status(403, "Blocked");
        String path = u.getPath() == null ? "/" : u.getPath();
        try {
            if (path.equals("/__file")) {
                File f = new File(u.getQueryParameter("p")).getCanonicalFile();
                String root = Environment.getExternalStorageDirectory().getCanonicalPath();
                if (!hasAccess() || !f.getPath().startsWith(root) || !f.getName().toLowerCase().endsWith(".pdf"))
                    return status(403, "Forbidden");
                return new WebResourceResponse("application/pdf", null, new FileInputStream(f));
            }
            if (path.equals("/")) path = "/index.html";
            InputStream in = getAssets().open("www" + path);
            String m = mime(path);
            return new WebResourceResponse(m, m.startsWith("image/") ? null : "utf-8", in);
        } catch (Exception e) {
            return status(404, "Not found");
        }
    }

    private boolean hasAccess() {
        if (Build.VERSION.SDK_INT >= 30) return Environment.isExternalStorageManager();
        return checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
    }

    private void walk(File dir, JSONArray out, int depth) throws Exception {
        if (depth > 8 || out.length() >= 1000) return;
        File[] list = dir.listFiles();
        if (list == null) return;
        for (File f : list) {
            String n = f.getName();
            if (n.startsWith(".")) continue;
            if (f.isDirectory()) {
                if (depth == 0 && n.equals("Android")) continue;
                walk(f, out, depth + 1);
            } else if (n.toLowerCase().endsWith(".pdf")) {
                JSONObject o = new JSONObject();
                o.put("name", n);
                o.put("path", f.getPath());
                out.put(o);
            }
        }
    }

    /** Funkce, které může volat stránka čtečky (window.Android). */
    private class Bridge {
        @JavascriptInterface
        public boolean hasAccess() {
            return MainActivity.this.hasAccess();
        }

        /** Otevře systémovou žádost o přístup k souborům; rozhoduje uživatel. */
        @JavascriptInterface
        public void askAccess() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 30) {
                    try {
                        startActivity(new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                                Uri.parse("package:" + getPackageName())));
                    } catch (Exception e) {
                        startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION));
                    }
                } else {
                    requestPermissions(new String[]{Manifest.permission.READ_EXTERNAL_STORAGE}, 2);
                }
            });
        }

        @JavascriptInterface
        public String listPdfs() {
            JSONArray out = new JSONArray();
            try {
                if (MainActivity.this.hasAccess()) walk(Environment.getExternalStorageDirectory(), out, 0);
            } catch (Exception e) { /* vrátím, co se našlo */ }
            return out.toString();
        }

        @JavascriptInterface
        public void print(String title) {
            runOnUiThread(() -> {
                PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                pm.print(title, web.createPrintDocumentAdapter(title), new PrintAttributes.Builder().build());
            });
        }
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        if (code != 1 || fileCb == null) return;
        Uri[] uris = null;
        if (result == RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null) {
                uris = new Uri[clip.getItemCount()];
                for (int i = 0; i < uris.length; i++) uris[i] = clip.getItemAt(i).getUri();
            } else if (data.getData() != null) {
                uris = new Uri[]{data.getData()};
            }
        }
        fileCb.onReceiveValue(uris);
        fileCb = null;
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.__back ? window.__back() : false", v -> {
            if (!"true".equals(v)) finish();
        });
    }
}
