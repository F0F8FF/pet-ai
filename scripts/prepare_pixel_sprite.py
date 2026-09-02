#!/usr/bin/env python3
"""픽셀 아트 스프라이트 정리 스크립트.

이미지 생성 모델은 픽셀 아트를 요청해도 1024px 캔버스에 "큰 사각형 블록"으로
그려서 준다. 진짜 32x32 스프라이트가 아니라 32x32처럼 보이는 1024x1024 이미지이고,
블록 경계에는 안티에일리어싱이 남아 색이 수백 개로 불어난다.
그대로 쓰면 브라우저가 다시 보간해서 흐려진다.

처리 순서가 중요하다:
  1. 원본 해상도에서 크로마키 배경을 알파로 분리 (여기서 해야 경계 오차가 1px로 작다)
  2. 각 셀에서 배경이 아닌 픽셀의 최빈색을 뽑아 축소
     - 평균(BOX)을 쓰면 안 된다. 원본이 이미 평평한 블록이라 평균낼 이유가 없고,
       눈처럼 한 블록뿐인 요소가 셀 경계에 걸치면 절반 농도로 번져 뭉개진다.
     - 배경 픽셀을 색 계산에서 아예 제외하므로 외곽에 배경색이 번지지 않는다.
  3. 셀의 절반 이상이 캐릭터인지로 알파를 0/255 로 결정 (픽셀 아트는 반투명 경계가 없어야 선명하다)
  4. 불투명 픽셀만 팔레트 양자화 (배경을 먼저 빼야 팔레트가 배경색에 낭비되지 않는다)

출력은 원본 해상도 스프라이트다. 화면에는 정수배(2x, 3x...)로,
CSS image-rendering: pixelated 와 함께 써야 선명하게 나온다.

--split 을 주면 가로로 늘어선 애니메이션 스트립으로 취급한다. 배경만 있는 열을
프레임 경계로 삼아 자르고, 발 바닥선과 상체 중심을 맞춰 정렬한 뒤 가로 한 줄
시트로 묶는다. 팔레트는 전체에서 한 번만 뽑아 프레임 간 색 깜빡임을 막는다.

--merge 는 색 병합 거리다. 값이 크면 색이 더 적게 남고, 작으면 안티에일리어싱
잔여색이 살아남는다. 색 "개수"가 아니라 "거리"로 조절하는 이유는 flatten_palette
주석에 적어두었다.

사용법:
    python3 scripts/prepare_pixel_sprite.py out/ in.png [in2.png ...] [--grid 32] [--merge 54]
    python3 scripts/prepare_pixel_sprite.py out/ walk-grid.png --split --grid 40
"""

from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

from PIL import Image, ImageChops

DEFAULT_GRID = 32
DEFAULT_MERGE = 54

# 파랑 우세도 임계값. (B - max(R,G)) 가 이 값을 넘으면 크로마키 배경으로 본다.
# 캐릭터에 강한 파랑이 없다는 전제이며, 그래서 배경은 순청색으로 생성한다.
BLUE_DOMINANCE = 40

# 셀에서 색을 뽑을 때 쓰는 내부 영역 비율. 경계의 안티에일리어싱을 피하려고
# 가운데 절반만 본다. 격자가 조금 어긋나도 견딘다.
CELL_INSET = 0.25

# 셀 내부에서 캐릭터 픽셀이 이 비율을 넘으면 불투명으로 채운다.
COVERAGE_CUTOFF = 0.5

# 격자 자동 검출 범위(스프라이트 한 변의 픽셀 수)
MIN_GRID = 20
MAX_GRID = 56

# 스트립 분할: 이보다 좁은 덩어리는 프레임으로 보지 않는다(잡티 방지).
MIN_FRAME_PX = 40

# 기준점을 잡을 때 "상체"로 볼 높이 비율. 아래쪽은 흔들리는 다리로 본다.
BODY_FRACTION = 0.6

# 잘라낸 프레임의 빈 영역을 채울 색. 알파가 0 이므로 화면에는 보이지 않는다.
BACKGROUND_FILL = (0, 0, 255)

# 최고 점수의 이 비율 이상이면 "정렬됐다"고 보고 더 촘촘한 격자를 택한다.
ALIGN_TOLERANCE = 0.85


def rgb_pixels(img: Image.Image) -> list[tuple[int, int, int]]:
    """tobytes 기반 픽셀 목록. getdata 의 deprecation 경고를 피한다."""
    raw = img.convert("RGB").tobytes()
    return [(raw[i], raw[i + 1], raw[i + 2]) for i in range(0, len(raw), 3)]


def blue_alpha_mask(img: Image.Image) -> Image.Image:
    """파랑 우세 픽셀을 투명(0)으로 만드는 알파 마스크. 원본 해상도에서 계산한다."""
    r, g, b = img.split()
    dominance = ImageChops.subtract(b, ImageChops.lighter(r, g))
    return dominance.point(lambda v: 0 if v > BLUE_DOMINANCE else 255)


def edge_energy(img: Image.Image, axis: str) -> list[float]:
    """축을 따라 인접한 라인 사이의 색 변화량. 블록 경계에서 값이 크다."""
    w, h = img.size
    px = rgb_pixels(img)
    n, other = (w, h) if axis == "x" else (h, w)
    stride = max(1, other // 128)  # 라인마다 전부 볼 필요는 없다

    energy = [0.0] * n
    for a in range(n - 1):
        total = 0
        for b in range(0, other, stride):
            i = b * w + a if axis == "x" else a * w + b
            j = b * w + a + 1 if axis == "x" else (a + 1) * w + b
            p, q = px[i], px[j]
            total += abs(p[0] - q[0]) + abs(p[1] - q[1]) + abs(p[2] - q[2])
        energy[a + 1] = float(total)  # a 와 a+1 사이의 경계는 인덱스 a+1 에 둔다
    return energy


def score_alignment(energy: list[float], n: int, grid: int, offset: int) -> float:
    """격자 경계가 실제 블록 경계에 얼마나 잘 얹히는지. 1.0 이 평균 수준이다."""
    mean = (sum(energy) / n) or 1.0
    block = n / grid

    hit = 0.0
    count = 0
    for k in range(grid + 1):
        x = int(round(offset + k * block))
        if 0 <= x < n:
            hit += energy[x]
            count += 1
    return (hit / count) / mean if count else 0.0


def detect_alignment(img: Image.Image) -> tuple[int, int, int, float]:
    """(격자, x오프셋, y오프셋, 점수) 검출.

    참 격자의 1/2, 1/3 배수도 모든 경계가 실제 블록 경계에 얹히므로 점수가 높다.
    그래서 최고점 근처에서 가장 큰 격자를 고른다 — 참 격자보다 촘촘해지면
    셀 중앙이 블록 내부에 갇혀 경계 에너지가 희석되므로 점수가 떨어진다.
    """
    ex, ey = edge_energy(img, "x"), edge_energy(img, "y")
    w, h = img.size

    def best_offset(energy: list[float], n: int, grid: int) -> tuple[float, int]:
        block = max(1, int(n / grid))
        return max(
            ((score_alignment(energy, n, grid, off), off) for off in range(block)),
            key=lambda pair: pair[0],
        )

    scored: list[tuple[float, int, int, int]] = []
    for grid in range(MIN_GRID, MAX_GRID + 1):
        sx, ox = best_offset(ex, w, grid)
        sy, oy = best_offset(ey, h, grid)
        scored.append(((sx + sy) / 2, grid, ox, oy))

    peak = max(s for s, _, _, _ in scored)
    for score, grid, ox, oy in sorted(scored, key=lambda t: -t[1]):
        if score >= peak * ALIGN_TOLERANCE:
            return grid, ox, oy, score
    return DEFAULT_GRID, 0, 0, 0.0


def cell_mode_downsample(
    img: Image.Image, alpha: Image.Image, gw: int, gh: int, ox: int = 0, oy: int = 0
) -> tuple[list[tuple[int, int, int]], list[int]]:
    """셀별 최빈색으로 gw×gh 로 축소한다. (색, 알파) 반환.

    각 셀의 가운데 절반만 보고, 그 안에서 배경이 아닌 픽셀들의 최빈색을 셀 색으로
    삼는다. 배경 픽셀은 색 계산에 넣지 않으므로 외곽 프린지가 원천적으로 없다.
    ox, oy 는 검출된 격자 오프셋이다.
    """
    w, h = img.size
    px = rgb_pixels(img)
    mask = alpha.tobytes()

    step_x, step_y = w / gw, h / gh
    inset_x, inset_y = step_x * CELL_INSET, step_y * CELL_INSET

    colors: list[tuple[int, int, int]] = []
    alphas: list[int] = []

    for gy in range(gh):
        top = oy + gy * step_y
        y0 = int(top + inset_y)
        y1 = max(y0 + 1, int(top + step_y - inset_y))

        for gx in range(gw):
            left = ox + gx * step_x
            x0 = int(left + inset_x)
            x1 = max(x0 + 1, int(left + step_x - inset_x))

            counts: Counter[tuple[int, int, int]] = Counter()
            total = 0
            for y in range(max(0, y0), min(y1, h)):
                row = y * w
                for x in range(max(0, x0), min(x1, w)):
                    total += 1
                    if mask[row + x]:
                        counts[px[row + x]] += 1

            covered = sum(counts.values())
            if total and covered / total >= COVERAGE_CUTOFF:
                colors.append(counts.most_common(1)[0][0])
                alphas.append(255)
            else:
                colors.append((0, 0, 0))
                alphas.append(0)

    return colors, alphas


def _dist2(a: tuple[int, int, int], b: tuple[int, int, int]) -> int:
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2


def flatten_palette(
    colors: list[tuple[int, int, int]],
    alphas: list[int],
    size: tuple[int, int],
    threshold: int,
) -> Image.Image:
    """안티에일리어싱으로 생긴 중간색을 없애고 평평한 팔레트로 만든다.

    median cut 을 쓰지 않는다. median cut 은 팔레트를 픽셀 수 기준으로 나누기
    때문에, 흰 강아지의 빨간 목걸이처럼 화면의 2% 뿐인 강조색이 검은 외곽선에
    병합돼 버린다. 색 수를 늘려도 잘 해결되지 않는다.

    대신 거리 기준으로 고른다. 빈도순으로 훑되 이미 고른 색과 threshold 안에
    있으면 버린다. 그러면 흔한 흰색 변형들은 하나로 합쳐지고, 멀리 떨어진
    빨강은 빈도와 무관하게 자기 칸을 지킨다.
    """
    counts = Counter(c for c, a in zip(colors, alphas) if a)
    if not counts:
        raise ValueError("불투명 픽셀이 없다. 배경 임계값을 확인할 것.")

    palette: list[tuple[int, int, int]] = []
    for color, _ in counts.most_common():
        if all(_dist2(color, kept) > threshold * threshold for kept in palette):
            palette.append(color)

    nearest: dict[tuple[int, int, int], tuple[int, int, int]] = {}
    for color in counts:
        nearest[color] = min(palette, key=lambda p: _dist2(color, p))

    result = Image.new("RGBA", size)
    result.putdata(
        [
            (*nearest[c], 255) if a else (0, 0, 0, 0)
            for c, a in zip(colors, alphas)
        ]
    )
    return result


Box = tuple[int, int, int, int]  # (x0, y0, x1, y1)


def _runs(flags: list[bool], min_len: int) -> list[tuple[int, int]]:
    """True 가 연속된 구간들. min_len 보다 짧은 것은 잡티로 버린다."""
    out: list[tuple[int, int]] = []
    start: int | None = None
    for i, on in enumerate(flags):
        if on and start is None:
            start = i
        elif not on and start is not None:
            if i - start >= min_len:
                out.append((start, i))
            start = None
    if start is not None and len(flags) - start >= min_len:
        out.append((start, len(flags)))
    return out


def frame_boxes(alpha: Image.Image) -> list[Box]:
    """프레임 상자들을 읽기 순서로 찾는다.

    배경만 있는 줄을 경계로 본다. 먼저 가로 밴드를 나누고 각 밴드 안에서 다시
    세로로 나누므로, 한 줄 스트립과 2×2 격자를 같은 코드로 처리한다.
    """
    w, h = alpha.size
    mask = alpha.tobytes()

    row_flags = [any(mask[y * w + x] for x in range(0, w, 2)) for y in range(h)]
    boxes: list[Box] = []

    for y0, y1 in _runs(row_flags, MIN_FRAME_PX):
        col_flags = [any(mask[y * w + x] for y in range(y0, y1, 2)) for x in range(w)]
        for x0, x1 in _runs(col_flags, MIN_FRAME_PX):
            boxes.append((x0, y0, x1, y1))
    return boxes


def frame_anchor(alpha: Image.Image, box: Box) -> tuple[int, int, int]:
    """(기준x, 바닥y, 높이) 계산.

    기준x 는 상체(다리 위쪽)의 가로 중심이다. 걷기에서 다리는 크게 흔들리지만
    머리와 몸통은 거의 제자리이므로, 상체를 기준으로 잡아야 프레임 사이에서
    몸이 좌우로 떨지 않는다. 바닥y 는 발끝이고 이것을 맞춰야 땅에 붙어 보인다.
    """
    w, _ = alpha.size
    mask = alpha.tobytes()
    x0, y0, x1, y1 = box

    ys = [y for y in range(y0, y1) if any(mask[y * w + x] for x in range(x0, x1))]
    top, bottom = ys[0], ys[-1]

    # 아래쪽은 흔들리는 다리로 보고 기준 계산에서 제외한다.
    body_limit = top + int((bottom - top) * BODY_FRACTION)
    xs: list[int] = []
    for y in range(top, min(body_limit + 1, y1)):
        row = y * w
        xs.extend(x for x in range(x0, x1) if mask[row + x])

    center = round(sum(xs) / len(xs)) if xs else (x0 + x1) // 2
    return center, bottom, bottom - top


def split_strip(img: Image.Image, alpha: Image.Image, grid: int, merge: int) -> list[Image.Image]:
    """스트립 또는 격자로 배치된 프레임들을 정렬된 같은 크기 프레임으로 자른다."""
    boxes = frame_boxes(alpha)
    if len(boxes) < 2:
        raise ValueError(f"프레임을 {len(boxes)}개만 찾았다. 배경이 프레임 사이를 갈라야 한다.")

    anchors = [frame_anchor(alpha, box) for box in boxes]

    # 모든 프레임을 담을 공통 상자. 기준점에서 각 방향 최대 거리를 취한다.
    left = max(cx - box[0] for (cx, _, _), box in zip(anchors, boxes))
    right = max(box[2] - cx for (cx, _, _), box in zip(anchors, boxes))
    up = max(height for _, _, height in anchors)

    # 원본에서 프레임 하나가 차지하는 상자. 발끝 아래로도 조금 여유를 준다.
    src_pad = max(4, (left + right) // 20)
    box_w = left + right + src_pad * 2
    box_h = up + src_pad * 2

    # 출력 프레임 크기. 세로를 grid 에 맞추고 가로는 원본 비율을 따른다.
    out_h = grid
    out_w = max(1, round(box_w / box_h * grid))

    # 자세를 나눠 생성할 때 캐릭터 크기를 맞추려면 이 배율이 같아야 한다.
    # 다른 이미지에서 뽑은 자세라도 배율이 같으면 강아지가 같은 크기로 나온다.
    print(f"  축소 배율: 원본 {box_h}px -> 출력 {out_h}px ({box_h / out_h:.3f} 원본px/출력px)")

    frames: list[Image.Image] = []
    for cx, bottom, _ in anchors:
        # 기준점이 상자 안에서 항상 같은 자리에 오도록 자른다. 이게 프레임 간
        # 정렬을 보장하는 부분이다.
        crop_left = cx - left - src_pad
        crop_top = bottom - up - src_pad
        window = (crop_left, crop_top, crop_left + box_w, crop_top + box_h)

        frame = Image.new("RGB", (box_w, box_h), BACKGROUND_FILL)
        frame.paste(img.crop(window), (0, 0))
        frame_alpha = Image.new("L", (box_w, box_h), 0)
        frame_alpha.paste(alpha.crop(window), (0, 0))

        colors, alphas = cell_mode_downsample(frame, frame_alpha, out_w, out_h)
        frames.append(flatten_palette(colors, alphas, (out_w, out_h), merge))

    return unify_palette(frames, merge)


def unify_palette(frames: list[Image.Image], merge: int) -> list[Image.Image]:
    """프레임들을 하나의 팔레트로 통일한다.

    프레임마다 따로 양자화하면 같은 흰색이 프레임별로 미세하게 달라져서
    재생할 때 색이 깜빡인다. 전부 이어 붙여 한 번만 양자화한 뒤 다시 나눈다.
    """
    if not frames:
        return frames

    fw, fh = frames[0].size
    strip = Image.new("RGBA", (fw * len(frames), fh))
    for i, frame in enumerate(frames):
        strip.paste(frame, (i * fw, 0))

    raw = strip.tobytes()
    colors = [(raw[i], raw[i + 1], raw[i + 2]) for i in range(0, len(raw), 4)]
    alphas = [raw[i + 3] for i in range(0, len(raw), 4)]

    flat = flatten_palette(colors, alphas, strip.size, merge)
    return [flat.crop((i * fw, 0, (i + 1) * fw, fh)) for i in range(len(frames))]


def report(sprite: Image.Image, label: str) -> None:
    raw = sprite.tobytes()
    used = {
        (raw[i], raw[i + 1], raw[i + 2]) for i in range(0, len(raw), 4) if raw[i + 3]
    }
    opaque = sum(1 for i in range(0, len(raw), 4) if raw[i + 3])
    w, h = sprite.size
    print(f"  {label}: {w}x{h} · 팔레트 {len(used)}색 · 불투명 {opaque}/{w * h}px")


def main() -> int:
    args = sys.argv[1:]
    forced_grid, merge = 0, DEFAULT_MERGE  # forced_grid 0 이면 자동 검출
    split = "--split" in args
    if split:
        args.remove("--split")

    for flag in ("--grid", "--merge"):
        if flag in args:
            i = args.index(flag)
            value = int(args[i + 1])
            args = args[:i] + args[i + 2 :]
            if flag == "--grid":
                forced_grid = value
            else:
                merge = value

    if len(args) < 2:
        print(__doc__)
        return 1

    out_dir = Path(args[0])
    out_dir.mkdir(parents=True, exist_ok=True)

    for raw in args[1:]:
        src = Path(raw)
        if not src.exists():
            print(f"건너뜀 (없는 파일): {src}")
            continue

        print(f"\n{src.name}")
        stem = src.stem.replace("-blue", "").replace("-sample", "").replace("-strip", "")

        with Image.open(src) as opened:
            img = opened.convert("RGB")
            alpha = blue_alpha_mask(img)

            if split:
                grid = forced_grid or DEFAULT_GRID
                frames = split_strip(img, alpha, grid, merge)
                fw, fh = frames[0].size

                # 가로 한 줄 시트로 묶는다. CSS background-position 으로 재생하면
                # 텍스처 하나만 쓰므로 프레임마다 src 를 바꾸는 것보다 가볍다.
                sheet = Image.new("RGBA", (fw * len(frames), fh))
                for i, frame in enumerate(frames):
                    sheet.paste(frame, (i * fw, 0))

                dst = out_dir / f"{stem}-{len(frames)}x{fw}x{fh}.png"
                sheet.save(dst)
                sheet.resize((sheet.width * 6, sheet.height * 6), Image.NEAREST).save(
                    out_dir / f"{stem}-sheet-preview6x.png"
                )
                report(sheet, f"프레임 {len(frames)}장 · 프레임당 {fw}x{fh}")
                print(f"  -> {dst}")
                continue

            ox = oy = 0
            grid = forced_grid
            if not grid:
                grid, ox, oy, score = detect_alignment(img)
                print(f"  격자 자동 검출: {grid}x{grid} · 오프셋 ({ox},{oy}) · 정렬점수 {score:.2f}")
            colors, alphas = cell_mode_downsample(img, alpha, grid, grid, ox, oy)

        sprite = flatten_palette(colors, alphas, (grid, grid), merge)
        dst = out_dir / f"{stem}-{grid}.png"
        sprite.save(dst)
        sprite.resize((grid * 8, grid * 8), Image.NEAREST).save(
            out_dir / f"{stem}-{grid}-preview8x.png"
        )
        report(sprite, f"격자 {grid}x{grid}")
        print(f"  -> {dst}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
