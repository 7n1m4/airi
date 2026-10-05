#!/usr/bin/env python3
"""Torch-free equivalent of web-rwkv assets/scripts/convert_safetensors.py.

Converts HuggingFace SafeTensors (BF16/F32/F16) to web-rwkv normalized F16 layout:
- Casts all weights to float16
- Lowercases tensor names
- Swaps axes for adapter/time-mix weight matrices

Usage:
    python3 convert_safetensors.py <input.safetensors> <output.st>
"""
import json
import struct
import sys
import numpy as np

TRANSPOSE = [
    "time_mix_w1", "time_mix_w2", "time_decay_w1", "time_decay_w2",
    "w1", "w2", "a1", "a2", "g1", "g2", "v1", "v2", "time_state", "lora.0"
]

def main(src, dst):
    with open(src, 'rb') as f:
        n = struct.unpack('<Q', f.read(8))[0]
        header = json.loads(f.read(n))
        base = 8 + n
        out_meta, chunks, off = {}, [], 0
        for name, info in header.items():
            if name == '__metadata__':
                continue
            s, e = info['data_offsets']
            f.seek(base + s)
            raw = f.read(e - s)
            dt = info['dtype']
            if dt == 'BF16':
                u = np.frombuffer(raw, dtype=np.uint16).astype(np.uint32) << 16
                a = u.view(np.float32).astype(np.float16)
            elif dt == 'F32':
                a = np.frombuffer(raw, dtype=np.float32).astype(np.float16)
            elif dt == 'F16':
                a = np.frombuffer(raw, dtype=np.float16)
            else:
                raise SystemExit(f'unsupported dtype {dt}')
            shape = list(info['shape'])
            a = a.reshape(shape)
            k = name.lower()
            for t in TRANSPOSE:
                if t in k and a.ndim >= 2:
                    a = np.swapaxes(a, -1, -2)
                    shape = list(a.shape)
                    break
            b = np.ascontiguousarray(a).tobytes()
            out_meta[k] = {'dtype': 'F16', 'shape': shape, 'data_offsets': [off, off + len(b)]}
            chunks.append(b)
            off += len(b)
    out_meta['__metadata__'] = {'format': 'pt'}
    h = json.dumps(out_meta).encode()
    h += b' ' * ((8 - len(h) % 8) % 8)
    with open(dst, 'wb') as g:
        g.write(struct.pack('<Q', len(h)))
        g.write(h)
        for c in chunks:
            g.write(c)
    print(f'Successfully wrote {dst}: {off} bytes of tensors')

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: python3 convert_safetensors.py <input.safetensors> <output.st>")
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])
