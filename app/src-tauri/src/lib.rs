//! Halation desktop shell.
//!
//! All image processing happens in the WebView (WebGL2). The Rust side only
//! exposes the command line (`--job <file>` written by the Lightroom plug-in),
//! the file system and native dialogs through the official Tauri plug-ins.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running Halation");
}
