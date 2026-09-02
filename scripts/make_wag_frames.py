#!/usr/bin/env python3
"""꼬리만 움직이는 흔들기 프레임을 만든다.

이미지 생성기에 "꼬리만 다르고 나머지는 똑같이" 를 요구해도 잘 지켜지지 않는다.
실제로는 귀와 눈, 발끝까지 1~2px 씩 달라지고, 그 상태로 빠르게 돌리면 꼬리가
흔들리는 게 아니라 강아지 전체가 잔떨림처럼 보인다.

그래서 코드로 강제한다. 기준 프레임 하나를 몸통으로 정하고, 다른 프레임에서는
"기준 실루엣 밖으로 나온 부분" 만 가져와 얹는다. 정면에서 꼬리는 몸 옆으로
삐져나오므로 이 규칙만으로 꼬리가 분리된다.

귀 끝이 1px 더 튀어나온 것도 실루엣 밖이라 같이 딸려온다. 그건 덩어리 크기로
걸러낸다. 꼬리는 수십 px 이지만 그런 잔여물은 몇 px 이다.

사용법:
    python3 scripts/make_wag_frames.py out.png in.png --frame-width 64 --base 6 --variants 5,7
"""

from __future__ import annotations

import sys
from collections import deque
from pathlib import Path

from PIL import Image

# 이보다 작은 덩어리는 꼬리가 아니라 외곽선 오차로 본다.
MIN_TAIL_AREA = 12


def blobs(pixels: set[tuple[int, int]]) -> list[set[tuple[int, int]]]:
    """8방향으로 이어진 덩어리들로 나눈다."""
    todo = set(pixels)
    found: list[set[tuple[int, int]]] = []

    while todo:
        seed = todo.pop()
        group = {seed}
        queue: deque[tuple[int, int]] = deque([seed])
        while queue:
            x, y = queue.popleft()
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    p = (x + dx, y + dy)
                    if p in todo:
                        todo.discard(p)
                        group.add(p)
                        queue.append(p)
        found.append(group)

    return found


def main() -> int:
    args = sys.argv[1:]
    opts: dict[str, str] = {}
    for flag in ("--frame-width", "--base", "--variants"):
        if flag in args:
            i = args.index(flag)
            opts[flag] = args[i + 1]
            args = args[:i] + args[i + 2 :]

    if len(args) < 2 or "--base" not in opts or "--variants" not in opts:
        print(__doc__)
        return 1

    dst, src = Path(args[0]), Path(args[1])
    dst.parent.mkdir(parents=True, exist_ok=True)

    with Image.open(src) as opened:
        sheet = opened.convert("RGBA")

    W, H = sheet.size
    fw = int(opts.get("--frame-width", W))
    base_index = int(opts["--base"])
    variants = [int(v) for v in opts["--variants"].split(",")]

    if W % fw:
        print(f"시트 너비 {W} 가 프레임 폭 {fw} 로 나뉘지 않는다.")
        return 1

    def frame(i: int) -> Image.Image:
        return sheet.crop((i * fw, 0, (i + 1) * fw, H))

    base = frame(base_index)
    base_alpha = base.getchannel("A").tobytes()
    out = sheet.copy()

    for v in variants:
        var = frame(v)
        var_alpha = var.getchannel("A").tobytes()

        outside = {
            (i % fw, i // fw)
            for i in range(fw * H)
            if var_alpha[i] and not base_alpha[i]
        }

        kept: set[tuple[int, int]] = set()
        dropped = 0
        for group in blobs(outside):
            if len(group) >= MIN_TAIL_AREA:
                kept |= group
            else:
                dropped += len(group)

        # 기준 몸통을 깔고 그 위에 꼬리만 얹는다.
        rebuilt = base.copy()
        for x, y in kept:
            rebuilt.putpixel((x, y), var.getpixel((x, y)))
        out.paste(rebuilt, (v * fw, 0))

        print(f"  frame {v}: 꼬리 {len(kept)}px 사용, 외곽선 오차 {dropped}px 버림")

    out.save(dst)
    out.resize((W * 5, H * 5), Image.NEAREST).save(dst.with_name(f"{dst.stem}-preview5x.png"))
    print(f"-> {dst}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
