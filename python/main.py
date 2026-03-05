"""
AI Desktop Pet – Python NLP Engine
Electron ↔ Python 통신: stdin/stdout JSON (한 줄 = 하나의 요청/응답)

지원 태스크:
  sentiment  – 텍스트 감정 분석 (긍정/부정/중립 + 점수)
  keywords   – 핵심 키워드 추출 (명사 빈도 기반)
  mood       – 대화 기록 기반 기분 리포트 (추이 + 요약)
"""

from __future__ import annotations

import json
import math
import sys
from collections import Counter
from typing import Any

# ── kiwipiepy 로드 (없으면 기본 한국어 토크나이저로 폴백) ─────────

try:
    from kiwipiepy import Kiwi

    _kiwi = Kiwi()

    def tokenize(text: str) -> list[tuple[str, str]]:
        """(형태소, 품사태그) 리스트 반환. NNG=일반명사, NNP=고유명사, VA=형용사 등"""
        return [(t.form, t.tag) for t in _kiwi.tokenize(text)]

except ImportError:
    import re

    _HANGUL = re.compile(r"[가-힣]+")

    def tokenize(text: str) -> list[tuple[str, str]]:
        return [(w, "NNG") for w in _HANGUL.findall(text) if len(w) >= 2]


# ── 감정 사전 ───────────────────────────────────────────────────

_POS = {
    "좋", "행복", "기쁘", "감사", "사랑", "즐겁", "편하", "웃", "귀엽", "멋지",
    "대박", "최고", "신나", "고마", "따뜻", "설레", "뿌듯", "만족", "든든", "훌륭",
    "기대", "재밌", "재미", "성공", "축하", "응원", "화이팅", "파이팅", "힘내",
    "좋아", "예쁘", "아름답", "상쾌", "맛있", "완벽",
}

_NEG = {
    "싫", "슬프", "화나", "짜증", "우울", "힘들", "아프", "지치", "걱정", "무섭",
    "별로", "못", "안돼", "실패", "스트레스", "피곤", "귀찮", "답답", "외롭",
    "불안", "후회", "미안", "죄송", "최악", "짜증나", "속상", "서운", "눈물",
    "화", "분노", "열받", "허무", "공허", "무기력",
}


def _sentiment_match(form: str, lexicon: set[str]) -> bool:
    return form in lexicon or any(form.startswith(w) for w in lexicon)


# ── 태스크 구현 ─────────────────────────────────────────────────

def analyze_sentiment(text: str) -> dict[str, Any]:
    """텍스트 감정 분석 → {score, label, positive, negative}"""
    tokens = tokenize(text)
    pos_count = sum(1 for f, _ in tokens if _sentiment_match(f, _POS))
    neg_count = sum(1 for f, _ in tokens if _sentiment_match(f, _NEG))
    total = pos_count + neg_count

    if total == 0:
        score = 0.0
    else:
        score = round((pos_count - neg_count) / total, 2)

    if score > 0.2:
        label = "positive"
        emoji = "😊"
    elif score < -0.2:
        label = "negative"
        emoji = "😢"
    else:
        label = "neutral"
        emoji = "😐"

    return {
        "score": score,
        "label": label,
        "emoji": emoji,
        "positive": pos_count,
        "negative": neg_count,
    }


def extract_keywords(text: str, top_n: int = 5) -> list[dict[str, Any]]:
    """텍스트에서 핵심 키워드(명사) 추출 → [{word, count, score}]"""
    tokens = tokenize(text)
    nouns = [f for f, tag in tokens if tag.startswith("NN") and len(f) >= 2]

    if not nouns:
        return []

    counter = Counter(nouns)
    max_count = counter.most_common(1)[0][1] if counter else 1

    results = []
    for word, count in counter.most_common(top_n):
        score = round(count / max_count, 2)
        results.append({"word": word, "count": count, "score": score})

    return results


def mood_report(messages: list[str]) -> dict[str, Any]:
    """대화 기록(문자열 리스트) 기반 기분 리포트"""
    if not messages:
        return {"overall": "neutral", "emoji": "😐", "avg_score": 0, "message_count": 0, "trend": "stable", "details": []}

    details = []
    scores = []
    for msg in messages:
        s = analyze_sentiment(msg)
        details.append({"text": msg[:30], "sentiment": s["label"], "score": s["score"]})
        scores.append(s["score"])

    avg = round(sum(scores) / len(scores), 2)

    if avg > 0.2:
        overall, emoji = "positive", "😊"
    elif avg < -0.2:
        overall, emoji = "negative", "😢"
    else:
        overall, emoji = "neutral", "😐"

    # 추이 계산 (후반부 vs 전반부)
    mid = len(scores) // 2
    if mid > 0:
        first_half = sum(scores[:mid]) / mid
        second_half = sum(scores[mid:]) / len(scores[mid:])
        diff = second_half - first_half
        if diff > 0.15:
            trend = "improving"
        elif diff < -0.15:
            trend = "declining"
        else:
            trend = "stable"
    else:
        trend = "stable"

    trend_labels = {"improving": "점점 좋아지고 있어요 📈", "declining": "좀 지쳐 보여요 📉", "stable": "안정적이에요 ➡️"}

    return {
        "overall": overall,
        "emoji": emoji,
        "avg_score": avg,
        "message_count": len(messages),
        "trend": trend,
        "trend_text": trend_labels[trend],
        "details": details[-10:],
    }


# ── 태스크 라우터 ───────────────────────────────────────────────

TASKS: dict[str, Any] = {
    "sentiment": lambda inp: analyze_sentiment(inp["text"]),
    "keywords": lambda inp: extract_keywords(inp["text"], inp.get("top_n", 5)),
    "mood": lambda inp: mood_report(inp["messages"]),
}


def main() -> None:
    """stdin에서 JSON 요청을 읽고 stdout으로 JSON 응답을 쓴다."""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            req_id = req.get("_id")
            task = req.get("task")
            if task not in TASKS:
                resp: dict[str, Any] = {"error": f"Unknown task: {task}"}
            else:
                result = TASKS[task](req.get("input", {}))
                resp = {"result": result}
            if req_id is not None:
                resp["_id"] = req_id
        except Exception as e:
            resp = {"error": str(e)}

        sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
