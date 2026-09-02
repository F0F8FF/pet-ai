#!/usr/bin/env python3
"""이미 만들어진 스프라이트에서 눈을 찾아 "감은 눈" 버전을 만든다.

눈 감은 프레임을 이미지 생성으로 따로 뽑으면 캐릭터가 미세하게 달라져서
원본과 번갈아 재생할 때 몸이 떨린다. 눈만 바꾸면 나머지 픽셀이 원본과
완전히 동일하므로 드리프트가 0이다.

눈을 찾는 방법:
    눈동자는 "어두운 덩어리 안에 있는 밝은 하이라이트"라는 특징이 있다.
    검은 귀는 크지만 안에 하이라이트가 없다. 그래서 밝은 픽셀 중 주변이
    대부분 어두운 것을 찾으면 그게 눈동자의 반사광이고, 거기 붙어 있는
    어두운 덩어리가 눈이다. 덩어리가 너무 크면 귀로 보고 버린다.

사용법:
    python3 scripts/make_blink_frame.py out.png in.png [--frame-width 66]
"""

from __future__ import annotations

import sys
from collections import Counter, deque
from pathlib import Path

from PIL import Image

BRIGHT_LUMA = 200
DARK_LUMA = 90

# 하이라이트로 인정하려면 바로 붙은 8이웃 중 이만큼이 어두워야 한다.
# 외곽선에 닿은 흰 몸통 픽셀은 한쪽만 어두워서(보통 3개 이하) 여기서 걸러진다.
NEIGHBOUR_DARK_MIN = 5

# 상하좌우 네 방향 모두 이 거리 안에 어두운 픽셀이 있어야 "둘러싸였다"고 본다.
# 코처럼 하이라이트가 없는 어두운 덩어리는 이 검사에서 떨어진다.
ENCLOSURE_REACH = 3

# 눈 덩어리로 인정하는 최대 면적(px). 이보다 크면 귀나 외곽선이다.
MAX_EYE_AREA = 48


def luma(c: tuple[int, int, int, int]) -> float:
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def find_eyes(px: list[tuple[int, int, int, int]], w: int, h: int) -> list[set[int]]:
    """눈 덩어리들(픽셀 인덱스 집합)을 찾는다."""
    opaque = [c[3] > 0 for c in px]
    lum = [luma(c) for c in px]

    def dark(i: int) -> bool:
        return opaque[i] and lum[i] < DARK_LUMA

    def enclosed(x: int, y: int) -> bool:
        """상하좌우 모두 가까이에 어두운 픽셀이 있는가."""
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            for k in range(1, ENCLOSURE_REACH + 1):
                nx, ny = x + dx * k, y + dy * k
                if 0 <= nx < w and 0 <= ny < h and dark(ny * w + nx):
                    break
            else:
                return False
        return True

    eyes: list[set[int]] = []
    claimed: set[int] = set()

    for y in range(h):
        for x in range(w):
            i = y * w + x
            if not opaque[i] or lum[i] < BRIGHT_LUMA or i in claimed:
                continue

            neighbours = sum(
                1
                for dy in (-1, 0, 1)
                for dx in (-1, 0, 1)
                if (dx or dy)
                and 0 <= x + dx < w
                and 0 <= y + dy < h
                and dark((y + dy) * w + x + dx)
            )
            if neighbours < NEIGHBOUR_DARK_MIN or not enclosed(x, y):
                continue

            # 하이라이트에 붙은 어두운 덩어리를 넓혀 나간다.
            blob: set[int] = set()
            queue: deque[int] = deque()
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and dark(ny * w + nx):
                        queue.append(ny * w + nx)

            overflow = False
            while queue:
                p = queue.popleft()
                if p in blob:
                    continue
                blob.add(p)
                if len(blob) > MAX_EYE_AREA:
                    overflow = True
                    break
                py, pxx = divmod(p, w)
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        nx, ny = pxx + dx, py + dy
                        if 0 <= nx < w and 0 <= ny < h:
                            q = ny * w + nx
                            if q not in blob and dark(q):
                                queue.append(q)

            if overflow:
                continue

            blob.add(i)  # 하이라이트도 눈의 일부다
            eyes.append(blob)
            claimed |= blob

    return eyes


def merge_blobs(blobs: list[set[int]], w: int, gap: int = 2) -> list[set[int]]:
    """겹치거나 붙어 있는 덩어리를 하나로 합친다.

    눈 하나에 하이라이트 픽셀이 여러 개면 같은 눈이 여러 번 검출된다. 합치지
    않으면 각자 자기 중심에 눈꺼풀 선을 그어서, 선이 원래 눈보다 아래로
    밀리거나 두 줄로 그려진다.
    """

    def box(blob: set[int]) -> tuple[int, int, int, int]:
        xs = [p % w for p in blob]
        ys = [p // w for p in blob]
        return min(xs), min(ys), max(xs), max(ys)

    def near(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> bool:
        return not (
            a[0] - gap > b[2] or b[0] - gap > a[2] or a[1] - gap > b[3] or b[1] - gap > a[3]
        )

    groups = [set(b) for b in blobs]
    changed = True
    while changed:
        changed = False
        for i in range(len(groups)):
            for j in range(i + 1, len(groups)):
                if near(box(groups[i]), box(groups[j])):
                    groups[i] |= groups[j]
                    del groups[j]
                    changed = True
                    break
            if changed:
                break
    return groups


def surrounding_color(
    px: list[tuple[int, int, int, int]], w: int, h: int, blob: set[int]
) -> tuple[int, int, int, int]:
    """덩어리 바로 밖에서 가장 흔한 색. 눈을 지운 자리를 이 색으로 덮는다."""
    ring: Counter[tuple[int, int, int, int]] = Counter()
    for p in blob:
        py, pxx = divmod(p, w)
        for dy in (-2, -1, 0, 1, 2):
            for dx in (-2, -1, 0, 1, 2):
                nx, ny = pxx + dx, py + dy
                if not (0 <= nx < w and 0 <= ny < h):
                    continue
                q = ny * w + nx
                if q in blob:
                    continue
                if px[q][3] > 0 and luma(px[q]) >= DARK_LUMA:
                    ring[px[q]] += 1
    return ring.most_common(1)[0][0] if ring else (255, 255, 255, 255)


def close_eye(px: list[tuple[int, int, int, int]], w: int, blob: set[int], fill: tuple[int, int, int, int]) -> None:
    """눈을 지우고 그 자리에 감은 눈 선을 그린다."""
    lid = min((px[p] for p in blob), key=luma)

    xs = [p % w for p in blob]
    ys = [p // w for p in blob]
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)

    for p in blob:
        px[p] = fill

    # 눈이 있던 자리의 세로 중앙에 선을 긋는다. 눈이 크면 두껍게.
    thickness = 2 if (y1 - y0) >= 6 else 1
    top = y0 + (y1 - y0) // 2
    for y in range(top, top + thickness):
        for x in range(x0, x1 + 1):
            px[y * w + x] = lid


def main() -> int:
    args = sys.argv[1:]
    frame_width = 0
    if "--frame-width" in args:
        i = args.index("--frame-width")
        frame_width = int(args[i + 1])
        args = args[:i] + args[i + 2 :]

    if len(args) < 2:
        print(__doc__)
        return 1

    dst, src = Path(args[0]), Path(args[1])
    if not src.exists():
        print(f"없는 파일: {src}")
        return 1
    dst.parent.mkdir(parents=True, exist_ok=True)

    with Image.open(src) as opened:
        img = opened.convert("RGBA")

    w, h = img.size
    fw = frame_width or w
    if w % fw:
        print(f"시트 너비 {w} 가 프레임 너비 {fw} 로 나뉘지 않는다.")
        return 1

    raw = img.tobytes()
    px = [(raw[i], raw[i + 1], raw[i + 2], raw[i + 3]) for i in range(0, len(raw), 4)]

    total = 0
    for f in range(w // fw):
        # 프레임 하나만 떼서 눈을 찾고, 결과를 원래 자리에 되돌린다.
        frame = [px[y * w + x] for y in range(h) for x in range(f * fw, (f + 1) * fw)]
        eyes = merge_blobs(find_eyes(frame, fw, h), fw)

        for blob in eyes:
            close_eye(frame, fw, blob, surrounding_color(frame, fw, h, blob))
        total += len(eyes)
        print(f"  프레임 {f + 1}: 눈 {len(eyes)}개")

        for y in range(h):
            for x in range(fw):
                px[y * w + f * fw + x] = frame[y * fw + x]

    if not total:
        print("눈을 찾지 못했다. BRIGHT_LUMA / MAX_EYE_AREA 를 조정할 것.")
        return 1

    out = Image.new("RGBA", (w, h))
    out.putdata(px)
    out.save(dst)

    preview = out.resize((w * 6, h * 6), Image.NEAREST)
    preview.save(dst.with_name(f"{dst.stem}-preview6x.png"))
    print(f"눈 {total}개 감김 -> {dst}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
