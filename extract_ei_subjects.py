#!/usr/bin/env python3
"""
Extract course-name, course-code, units, instructor, start/end time, and date from
EI/UC Irvine style text exports and save to CSV.
"""

from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path


MONTHS = (
    "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
    "Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?"
)
DATE_TO_CODE_RE = re.compile(
    rf"\b(?:{MONTHS})\s+\d{{1,2}}\s*-\s*(?:{MONTHS})\s+\d{{1,2}}\s+(.+)$"
)
DATE_LINE_RE = re.compile(
    rf"\b(?:{MONTHS})\s+\d{{1,2}},\s*\d{{4}}\s*-\s*(?:{MONTHS})\s+\d{{1,2}},\s*\d{{4}}\b"
)
DAY_LINE_RE = re.compile(
    r"^(?:Mo|Mon|Tu|Tue|We|Wed|Th|Thu|Fr|Fri|Sa|Sat|Su|Sun)"
    r"(?:,\s*(?:Mo|Mon|Tu|Tue|We|Wed|Th|Thu|Fr|Fri|Sa|Sat|Sun))*$"
)
TIME_RANGE_RE = re.compile(r"(\d{1,2}:\d{2}\s*[aApP][mM])\s*-\s*(\d{1,2}:\d{2}\s*[aApP][mM])")


def is_online_title(title: str) -> bool:
    return "(on-line)" in title.lower()


def normalize_units(raw: str) -> str:
    raw = raw.strip()
    if not raw:
        return raw
    if re.fullmatch(r"\d+\.0+", raw):
        return str(int(float(raw)))
    return raw


def normalize_time(value: str) -> str:
    return value.replace(" ", "").upper()


def parse_time_range(text: str) -> tuple[str, str]:
    match = TIME_RANGE_RE.search(text)
    if not match:
        return "", ""
    return normalize_time(match.group(1)), normalize_time(match.group(2))


def parse_course_number(line: str) -> str:
    base = line.split("offered through", 1)[0]
    base = base.rsplit(" - ", 1)[0]
    match = DATE_TO_CODE_RE.search(base)
    return match.group(1).strip() if match else ""


def parse_file(text: str) -> list[tuple[str, str, str, str, str, str, str]]:
    sample = "\n".join(line for line in text.splitlines()[:40] if line.strip())
    if "Dept. & Num." in sample and "Course Title" in sample:
        return parse_uci_style(text)
    return parse_ei_style(text)


def parse_ei_style(text: str) -> list[tuple[str, str, str, str, str, str, str]]:
    rows = []
    for chunk in text.split("How to apply"):
        lines = [ln.strip() for ln in chunk.splitlines() if ln.strip()]
        if not lines:
            continue

        header_idx = next((i for i, ln in enumerate(lines) if "offered through" in ln), None)
        if header_idx is None:
            continue

        course_number = parse_course_number(lines[header_idx])
        if not course_number:
            continue

        units_line = next((ln for ln in lines if ln.startswith("Units:")), None)
        if not units_line:
            continue
        units = normalize_units(units_line.split(":", 1)[1].strip())

        name_idx: int | None = None
        for i in range(header_idx + 1, len(lines)):
            line = lines[i]
            if line.lower() in {"section closed", "time conflict enrollment allowed"}:
                continue
            if line.startswith("Units:"):
                break
            if DATE_LINE_RE.search(line) or DAY_LINE_RE.fullmatch(line):
                continue
            name_idx = i
            break

        if name_idx is None:
            continue

        name = lines[name_idx]
        if is_online_title(name):
            continue

        date_idx = None
        for j in range(name_idx + 1, len(lines)):
            if DATE_LINE_RE.search(lines[j]):
                date_idx = j
                break

        instructor = ""
        instructor_end = date_idx if date_idx is not None else len(lines)
        for i in range(name_idx + 1, instructor_end):
            line = lines[i]
            if line.lower() in {"section closed", "time conflict enrollment allowed"}:
                continue
            if DAY_LINE_RE.fullmatch(line) or parse_time_range(line)[0]:
                continue
            instructor = line
            break

        start, end = "", ""
        for line in lines[date_idx + 1 if date_idx is not None else (name_idx + 1) :]:
            s, e = parse_time_range(line)
            if s:
                start, end = s, e
                break

        date_value = lines[date_idx] if date_idx is not None else ""
        rows.append((name, course_number, units, instructor, start, end, date_value))
    return rows


def parse_uci_style(text: str) -> list[tuple[str, str, str, str, str, str, str]]:
    rows = []
    started = False
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if "Dept. & Num." in line and "Course Title" in line:
            started = True
            continue
        if not started:
            continue
        if line.lower().startswith("pagination") or line == "How to apply":
            continue

        parts = [p.strip() for p in raw_line.split("\t")]
        if len(parts) < 10:
            continue

        code = parts[1]
        title = parts[-1]
        if not code or not title or is_online_title(title):
            continue

        units = normalize_units(parts[4]) if len(parts) > 4 else ""
        instructor = parts[6] if len(parts) > 6 else ""
        start, end = parse_time_range(parts[7]) if len(parts) > 7 else ("", "")
        rows.append((title, code, units, instructor, start, end, ""))
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract course list fields to CSV")
    parser.add_argument("input", nargs="?", default="ei.txt")
    parser.add_argument("output", nargs="?", default="courses/courses.csv")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)
    text = input_path.read_text(encoding="utf-8")
    rows = parse_file(text)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(["과목명", "과목번호", "이수학점", "교수명", "시작시간", "종료시간", "날짜"])
        writer.writerows(rows)


if __name__ == "__main__":
    main()
