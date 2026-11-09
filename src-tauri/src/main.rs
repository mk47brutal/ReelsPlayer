#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
struct VideoFile {
    name: String,
    path: String,
}

fn walk(dir: &Path, exts: &[&str], out: &mut Vec<VideoFile>, depth: u32) {
    if depth > 6 {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for entry in rd.flatten() {
        let p = entry.path();
        if p.is_dir() {
            walk(&p, exts, out, depth + 1);
        } else if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
            if exts.contains(&ext.to_lowercase().as_str()) {
                out.push(VideoFile {
                    name: p.file_name().unwrap().to_string_lossy().into_owned(),
                    path: p.to_string_lossy().into_owned(),
                });
            }
        }
    }
}

#[tauri::command]
fn scan_folder(path: String) -> Result<Vec<VideoFile>, String> {
    let p = Path::new(&path);
    if !p.is_dir() {
        return Err(format!("Not a folder: {}", path));
    }
    let exts = ["mp4", "mkv", "webm", "mov", "avi", "m4v"];
    let mut out = Vec::new();
    walk(p, &exts, &mut out, 0);
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![scan_folder])
        .run(tauri::generate_context!())
        .expect("error while running ReelPlay");
}