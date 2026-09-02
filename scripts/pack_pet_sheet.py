#!/usr/bin/env python3
"""여러 자세 시트를 하나의 시트로 묶는다.

자세마다 이미지를 따로 생성하면 프레임 크기가 조금씩 다르게 나온다. 그대로
이어 붙이면 걷기에서 앉기로 넘어갈 때 강아지가 위아래로 튄다. 그래서 각
프레임의 발 바닥선과 상체 중심을 찾아 같은 자리에 오도록 다시 배치한다.

팔레트도 마지막에 한 번 통일한다. 자세별로 따로 양자화하면 흰색이 미세하게
달라서 자세가 바뀌는 순간 색이 튄다.

사용법:
    python3 scripts/pack_pet_sheet.py out.png walk.png:66 sit.png:61
    python3 scripts/pack_pet_sheet.py out.png walk.png:66 sit.png:61:1,2,3
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from prepare_pixel_sprite import DEFAULT_MERGE, flatten_palette, frame_anchor  # noqa: E402

PAD = 2


def load_frames(spec: str) -> list[Image.Image]:
    """'path.png:frameWidth[:0,2,3]' 를 프레임 목록으로 읽는다."""
    parts = spec.split(":")
    if len(parts) < 2:
        raise ValueError(f"형식이 틀렸다: {spec}  (path.png:frameWidth[:indices])")

    path, fw = Path(parts[0]), int(parts[1])
    with Image.open(path) as opened:
        sheet = opened.convert("RGBA")

    w, h = sheet.size
    if w % fw:
        raise ValueError(f"{path.name}: 너비 {w} 가 프레임 폭 {fw} 로 나뉘지 않는다.")

    count = w // fw
    wanted = [int(v) for v in parts[2].split(",")] if len(parts) > 2 else list(range(count))
    for i in wanted:
        if not 0 <= i < count:
            raise ValueError(f"{path.name}: 프레임 {i} 없음 (0~{count - 1})")

    print(f"  {path.name}: {count}장 중 {len(wanted)}장 사용 {wanted}")
    return [sheet.crop((i * fw, 0, (i + 1) * fw, h)) for i in wanted]


def main() -> int:
    args = sys.argv[1:]
    if len(args) < 2:
        print(__doc__)
        return 1

    dst = Path(args[0])
    dst.parent.mkdir(parents=True, exist_ok=True)

    frames: list[Image.Image] = []
    for spec in args[1:]:
        frames.extend(load_frames(spec))

    # 각 프레임의 기준점(상체 중심 x, 발 바닥 y)을 구한다.
    anchors = []
    for frame in frames:
        alpha = frame.getchannel("A")
        bbox = alpha.getbbox()
        if bbox is None:
            raise ValueError("빈 프레임이 있다.")
        cx, bottom, _ = frame_anchor(alpha, (bbox[0], bbox[1], bbox[2], bbox[3]))
        anchors.append((cx, bottom, bbox))

    # 모든 프레임이 들어갈 공통 상자. 기준점에서 각 방향 최대 거리를 취한다.
    left = max(cx - bbox[0] for cx, _, bbox in anchors)
    right = max(bbox[2] - cx for cx, _, bbox in anchors)
    up = max(bottom - bbox[1] for _, bottom, bbox in anchors)

    fw = left + right + PAD * 2
    fh = up + PAD * 2
    print(f"\n공통 프레임 {fw}x{fh} · 기준점 x={left + PAD} 바닥 y={up + PAD}")

    sheet = Image.new("RGBA", (fw * len(frames), fh))
    for i, (frame, (cx, bottom, _)) in enumerate(zip(frames, anchors)):
        # 기준점이 공통 상자 안에서 항상 같은 자리에 오게 옮긴다.
        ox = i * fw + (left + PAD) - cx
        oy = (up + PAD) - bottom
        sheet.paste(frame, (ox, oy), frame)

    # 자세가 바뀌는 순간 색이 튀지 않도록 전체를 한 팔레트로 맞춘다.
    raw = sheet.tobytes()
    colors = [(raw[i], raw[i + 1], raw[i + 2]) for i in range(0, len(raw), 4)]
    alphas = [raw[i + 3] for i in range(0, len(raw), 4)]
    sheet = flatten_palette(colors, alphas, sheet.size, DEFAULT_MERGE)

    sheet.save(dst)
    sheet.resize((sheet.width * 5, sheet.height * 5), Image.NEAREST).save(
        dst.with_name(f"{dst.stem}-preview5x.png")
    )

    final = sheet.tobytes()
    used = {
        (final[i], final[i + 1], final[i + 2]) for i in range(0, len(final), 4) if final[i + 3]
    }
    print(f"프레임 {len(frames)}장 · {sheet.width}x{sheet.height} · 팔레트 {len(used)}색")
    print(f"-> {dst}")

    for i, (_, _, bbox) in enumerate(anchors):
        print(f"  frame {i}: 원본 bbox {bbox}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
