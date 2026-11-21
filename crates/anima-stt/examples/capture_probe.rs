// SPDX-License-Identifier: GPL-3.0-or-later

//! Dev probe: list cpal input devices and their supported configs.
//! `cargo run -p airi-stt --example capture_probe`

use cpal::traits::{DeviceTrait, HostTrait};

fn main() {
    let host = cpal::default_host();
    println!("default host id: {:?}", host.id());
    println!(
        "default input device: {:?}",
        host.default_input_device().map(|d| {
            d.description()
                .map(|desc| desc.name().to_string())
                .unwrap_or_else(|e| format!("<desc err: {e}>"))
        })
    );
    match host.input_devices() {
        Ok(devices) => {
            for device in devices {
                let name = device
                    .description()
                    .map(|d| d.name().to_string())
                    .unwrap_or_else(|e| format!("<desc err: {e}>"));
                println!("device: {name}");
                match device.supported_input_configs() {
                    Ok(configs) => {
                        for config in configs {
                            println!(
                                "    channels={} {:?} rate={}..={} buffer={:?}",
                                config.channels(),
                                config.sample_format(),
                                config.min_sample_rate(),
                                config.max_sample_rate(),
                                config.buffer_size(),
                            );
                        }
                    }
                    Err(e) => println!("    <supported_input_configs error: {e}>"),
                }
            }
        }
        Err(e) => println!("<input_devices error: {e}>"),
    }
}
