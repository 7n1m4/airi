// SPDX-License-Identifier: GPL-3.0-or-later

//! Dev probe: print per-frame speech probabilities for synthetic signals.
//! Not a test; run with `cargo run -p airi-stt --example vad_probe`.

use airi_stt::vad::{SileroVad, VadConfig, FRAME_SAMPLES};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut vad = SileroVad::load_default_with_config(VadConfig::default()).await?;
    {
        let meta = vad.session_metadata();
        println!(
            "producer={:?} version={:?} custom={:?}",
            meta.0, meta.1, meta.2
        );
        // Dump model I/O signature.
        println!("inputs:");
        for outlet in vad.session_inputs() {
            println!("  {} :: {:?}", outlet.name(), outlet.dtype());
        }
        println!("outputs:");
        for outlet in vad.session_outputs() {
            println!("  {} :: {:?}", outlet.name(), outlet.dtype());
        }
    }
    let mode = std::env::args().nth(1).unwrap_or_else(|| "all".into());

    type SignalFn = Box<dyn Fn(usize, usize) -> i16>;
    let signals: Vec<(&str, SignalFn)> = vec![
        ("silence", Box::new(|_f, _i| 0)),
        (
            "loud_noise",
            Box::new(|f: usize, i: usize| -> i16 {
                let n = (i as u64).wrapping_mul(2654435761) ^ (f as u64).wrapping_mul(40503);
                let x = ((n >> 16) & 0xffff) as f32 / 65536.0 * 2.0 - 1.0;
                (x * 0.9 * i16::MAX as f32) as i16
            }),
        ),
        (
            "loud_harmonic",
            Box::new(|f, i| {
                let t = (f * FRAME_SAMPLES + i) as f32 / 16000.0;
                let f0 = 150.0f32;
                ((t * f0 * std::f32::consts::TAU).sin() * 0.9 * i16::MAX as f32) as i16
            }),
        ),
        (
            "harmonic_am",
            Box::new(|f, i| {
                let t = (f * FRAME_SAMPLES + i) as f32 / 16000.0;
                let f0 = 140.0f32;
                let mut s = 0.0f32;
                for (harmonic, amp) in [
                    (1.0f32, 1.0f32),
                    (2.0, 0.6),
                    (3.0, 0.4),
                    (4.0, 0.25),
                    (5.0, 0.15),
                ] {
                    s += amp * (t * f0 * harmonic * std::f32::consts::TAU).sin();
                }
                let am = 0.5 + 0.5 * (t * 6.0 * std::f32::consts::TAU).sin();
                (s * 0.45 * am * i16::MAX as f32) as i16
            }),
        ),
        (
            "pulse_glottal",
            Box::new(|f, i| {
                // Crude glottal-pulse-like buzz: harmonics with steeper rolloff + slow AM.
                let t = (f * FRAME_SAMPLES + i) as f32 / 16000.0;
                let f0 = 125.0f32;
                let mut s = 0.0f32;
                for h in 1..=8 {
                    let amp = 1.0 / (h * h) as f32;
                    s += amp * (t * f0 * h as f32 * std::f32::consts::TAU).sin();
                }
                let am = 0.35 + 0.65 * ((t * 4.3 * std::f32::consts::TAU).sin() * 0.5 + 0.5);
                let breath = ((i.wrapping_mul(2654435761) ^ f.wrapping_mul(40503)) % 1024) as f32
                    / 1024.0
                    - 0.5;
                ((s * am * 1.6 + breath * 0.01) * i16::MAX as f32)
                    .clamp(i16::MIN as f32, i16::MAX as f32) as i16
            }),
        ),
        (
            "vowel_aa",
            Box::new(|f, i| {
                // Formant-ish "ah": f0=110Hz, formants at 700/1100/2500 with band energy.
                let t = (f * FRAME_SAMPLES + i) as f32 / 16000.0;
                let f0 = 110.0f32;
                let mut s = 0.0f32;
                // low harmonics near F1/F2 dominate
                for h in 1..=22 {
                    let freq = f0 * h as f32;
                    let bw = |center: f32, width: f32| (-((freq - center) / width).powi(2)).exp();
                    let amp = 1.0
                        + 6.0 * bw(700.0, 150.0)
                        + 3.0 * bw(1100.0, 200.0)
                        + 1.5 * bw(2500.0, 300.0);
                    s += (amp / h as f32) * (t * freq * std::f32::consts::TAU).sin();
                }
                let am = 0.55 + 0.45 * (t * 5.0 * std::f32::consts::TAU).sin();
                (s * 0.22 * am * i16::MAX as f32).clamp(i16::MIN as f32, i16::MAX as f32) as i16
            }),
        ),
    ];

    for (name, signal) in signals {
        if mode != "all" && mode != name {
            continue;
        }
        vad.reset();
        let mut probs = Vec::new();
        for f in 0..60 {
            let frame: Vec<i16> = (0..FRAME_SAMPLES).map(|i| signal(f, i)).collect();
            probs.push(vad.probability(&frame)?);
        }
        let max = probs.iter().cloned().fold(0.0f32, f32::max);
        let mean = probs.iter().sum::<f32>() / probs.len() as f32;
        println!("{name:14} max={max:.3} mean={mean:.3}");
        println!(
            "  probs: {:?}",
            probs.iter().map(|p| format!("{p:.2}")).collect::<Vec<_>>()
        );

        vad.reset();
        let frame: Vec<i16> = (0..FRAME_SAMPLES).map(|i| signal(0, i)).collect();
        let p0 = vad.probability(&frame)?;
        println!(
            "  first-frame prob={p0:.4} state_norm={:.4}",
            vad.state_norm()
        );
    }
    Ok(())
}
