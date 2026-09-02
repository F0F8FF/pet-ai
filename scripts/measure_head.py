#!/usr/bin/env python3
"""스프라이트의 머리 높이를 재서 자세끼리 크기가 맞는지 확인한다.

자세를 나눠 생성하면 캐릭터 크기가 달라진다. 그런데 크기를 비교할 척도를
고르기가 까다롭다.

  - 몸 전체 높이: 다리를 굽히거나 앉으면 달라져서 쓸 수 없다.
  - 검은 귀 면적: 측면은 귀가 하나, 정면은 둘이라 시점이 다르면 못 쓴다.
  - 눈 크기: 정면 얼굴은 일부러 눈을 크게 그리는 경우가 있어 흔들린다.

빨간 목걸이는 항상 목에 있고 어느 시점에서도 보인다. 그래서 머리 꼭대기부터
목걸이 위쪽까지의 높이를 머리 크기로 삼는다. 이 값이 같으면 같은 크기의
강아지로 보인다.

사용법:
    python3 scripts/measure_head.py sheet.png:64 other.png:61
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image


def is_red(r: int, g: int, b: int) -> bool:
    return r > 140 and g < 100 and b < 100


def head_height(frame: Image.Image) -> tuple[int, int, int] | None:
    """(머리높이, 스프라이트 top, 목걸이 top) 반환."""
    w, h = frame.size
    raw = frame.tobytes()

    top = None
    collar = None
    for y in range(h):
        for x in range(w):
            k = (y * w + x) * 4
            if not raw[k + 3]:
                continue
            if top is None:
                top = y
            if is_red(raw[k], raw[k + 1], raw[k + 2]):
                collar = y
                break
        if collar is not None:
            break

    if top is None or collar is None:
        return None
    return collar - top, top, collar


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 1

    for spec in args:
        path_s, fw_s = spec.rsplit(":", 1)
        path, fw = Path(path_s), int(fw_s)

        with Image.open(path) as opened:
            sheet = opened.convert("RGBA")

        w, h = sheet.size
        print(f"\n{path.name}  ({w // fw}장, 프레임 {fw}x{h})")

        heights = []
        for i in range(w // fw):
            frame = sheet.crop((i * fw, 0, (i + 1) * fw, h))
            got = head_height(frame)
            if got is None:
                print(f"  frame {i}: 목걸이를 못 찾음")
                continue
            hh, top, collar = got
            heights.append(hh)
            print(f"  frame {i}: 머리높이 {hh}px  (top y={top}, 목걸이 y={collar})")

        if heights:
            print(f"  평균 머리높이 {sum(heights) / len(heights):.2f}px")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
