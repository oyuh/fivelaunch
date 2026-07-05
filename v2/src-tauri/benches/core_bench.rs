//! Performance benchmarks for hot core paths.
//!
//! Run with: `cargo bench` (from v2/src-tauri).
//! These guard the perf story of the rewrite — folder walking and config
//! parsing are on the critical path of every UI refresh and launch.

use criterion::{criterion_group, criterion_main, Criterion};
use std::fs;
use std::hint::black_box;
use std::path::Path;

use fivelaunch_lib::core::clients::ClientConfig;
use fivelaunch_lib::core::stats::folder_stats;

/// Build a synthetic plugin-folder-like tree: `dirs` directories with `files`
/// small files each.
fn build_tree(root: &Path, dirs: usize, files: usize) {
    for d in 0..dirs {
        let dir = root.join(format!("dir_{d:03}"));
        fs::create_dir_all(&dir).unwrap();
        for f in 0..files {
            fs::write(dir.join(format!("file_{f:03}.ini")), b"[SETTINGS]\nkey=value\n").unwrap();
        }
    }
}

fn bench_folder_stats(c: &mut Criterion) {
    let tmp = tempfile::tempdir().unwrap();
    build_tree(tmp.path(), 40, 50); // 2,000 files

    c.bench_function("folder_stats_2000_files", |b| {
        b.iter(|| black_box(folder_stats(tmp.path())))
    });
}

fn bench_config_parse(c: &mut Criterion) {
    // A config with 50 clients — far above realistic, so real usage is faster.
    let mut config = ClientConfig::default();
    for i in 0..50 {
        let mut client = fivelaunch_lib::core::clients::ClientProfile::default();
        client.id = format!("00000000-0000-4000-8000-{i:012}");
        client.name = format!("Client {i}");
        client.last_played = Some(1_719_849_600_000 + i as u64);
        config.clients.push(client);
    }
    let json = serde_json::to_string_pretty(&config).unwrap();

    c.bench_function("clients_json_parse_50_clients", |b| {
        b.iter(|| black_box(serde_json::from_str::<ClientConfig>(&json).unwrap()))
    });

    c.bench_function("clients_json_serialize_50_clients", |b| {
        b.iter(|| black_box(serde_json::to_string_pretty(&config).unwrap()))
    });
}

criterion_group!(benches, bench_folder_stats, bench_config_parse);
criterion_main!(benches);
