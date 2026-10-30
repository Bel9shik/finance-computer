use tauri::Manager;
use webview2_com::{
    take_pwstr, Microsoft::Web::WebView2::Win32::*, WebResourceRequestedEventHandler,
};
use windows::core::{w, Interface, PWSTR};

fn local_resource(url: &tauri::Url) -> bool {
    url.scheme() == "http"
        && matches!(url.host_str(), Some("tauri.localhost" | "ipc.localhost"))
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
}

pub fn install(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    let dev_url = window.app_handle().config().build.dev_url.clone();
    window.with_webview(move |view| unsafe {
        let core = view.controller().CoreWebView2().expect("WebView2 core");
        let environment = view.environment();
        let denied = environment
            .CreateWebResourceResponse(None, 403, w!("Offline"), w!(""))
            .expect("Offline response");
        // NavigationStarting can cancel the page after WebView2 has already sent its GET.
        if let Ok(core22) = core.cast::<ICoreWebView2_22>() {
            core22.AddWebResourceRequestedFilterWithRequestSourceKinds(
                w!("*"),
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
            )
        } else {
            core.AddWebResourceRequestedFilter(w!("*"), COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL)
        }
        .expect("Offline request filter");
        core.add_WebResourceRequested(
            &WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
                if let Some(args) = args {
                    let mut uri = PWSTR::null();
                    let read = args.Request().and_then(|request| request.Uri(&mut uri));
                    let uri = take_pwstr(uri);
                    let allowed = read.is_ok()
                        && tauri::Url::parse(&uri).is_ok_and(|url| {
                            local_resource(&url)
                                || (cfg!(dev)
                                    && dev_url
                                        .as_ref()
                                        .is_some_and(|dev| url.origin() == dev.origin()))
                        });
                    if !allowed {
                        args.SetResponse(&denied).expect("Block external request");
                    }
                }
                Ok(())
            })),
            &mut 0,
        )
        .expect("Offline request handler");
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_bundled_assets_and_native_ipc_are_allowed() {
        for url in [
            "http://tauri.localhost/assets/app.js",
            "http://ipc.localhost/load_ledger",
        ] {
            assert!(local_resource(&url.parse().unwrap()), "{url}");
        }
        for url in [
            "http://127.0.0.1:43127/offline-navigation",
            "https://example.com/",
            "http://ipc.localhost.evil.test/",
            "http://ipc.localhost:1234/",
            "https://tauri.localhost/",
            "http://user:password@tauri.localhost/",
            "file:///C:/test",
        ] {
            assert!(!local_resource(&url.parse().unwrap()), "{url}");
        }
    }
}
