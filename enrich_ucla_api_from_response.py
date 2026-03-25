#!/usr/bin/env python3
"""
Re-hydrate UCLA API blocks so each row has weekday and time strings that can be
used by the frontend timetable parser.
"""

from __future__ import annotations

import csv
import html
import json
import re
import time as time_module
from html.parser import HTMLParser
from pathlib import Path

import requests


INPUT_CSV = Path("courses/ucla_courses_api_all_blocks.csv")
OUTPUT_CSV = Path("courses/ucla_courses_api_all_blocks.csv")
URL = "https://sa.ucla.edu/ro/public/soc/Results/GetCourseSummary"

FILTER_FLAGS = {
    "enrollment_status": "O,W,C,X,T,S",
    "advanced": "y",
    "meet_days": "M,T,W,R,F",
    "start_time": "10:00 am",
    "end_time": "5:00 pm",
    "meet_locations": None,
    "meet_units": None,
    "instructor": None,
    "class_career": None,
    "impacted": "N",
    "enrollment_restrictions": "n",
    "enforced_requisites": None,
    "individual_studies": "n",
    "summer_session": "A08",
}

TIME_RE = re.compile(
    r"(?P<h1>\\d{1,2})(?::(?P<m1>\\d{2}))?\\s*(?P<a1>[AaPp])[Mm]\\s*[-–]\\s*(?P<h2>\\d{1,2})(?::(?P<m2>\\d{2}))?\\s*(?P<a2>[AaPp])[Mm]"
)


def normalize_catalog(raw: str) -> str:
    return re.sub(r"\\s+", "", str(raw).strip())


def normalize_code(raw: str) -> str:
    return str(raw).strip()


def normalize_text(raw: str) -> str:
    if raw is None:
        return ""
    return " ".join(html.unescape(str(raw)).split())


def parse_time_value(match: re.Match[str]) -> tuple[str, str]:
    h1 = int(match.group("h1"))
    h2 = int(match.group("h2"))
    m1 = match.group("m1") or "00"
    m2 = match.group("m2") or "00"
    a1 = match.group("a1").upper()
    a2 = match.group("a2").upper()
    start = f"{h1}:{m1}{a1}M"
    end = f"{h2}:{m2}{a2}M"
    return start.upper(), end.upper()


class DayTimeParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self._day_buf: dict[str, str] = {}
        self._time_buf: dict[str, str] = {}
        self.stack: list[str] = []
        self.days_map: dict[str, list[str]] = {}
        self.time_map: dict[str, list[str]] = {}

    @staticmethod
    def _trim(value: str) -> str:
        return " ".join(value.split())

    def handle_starttag(self, tag, attrs):
        if tag.lower() != "div":
            return
        attrs_dict = dict(attrs)
        element_id = attrs_dict.get("id", "")
        if element_id.endswith("-days_data"):
            self.stack.append(f"days:{element_id}")
            return
        if element_id.endswith("-time_data"):
            self.stack.append(f"time:{element_id}")
            return
        self.stack.append("other")

    def handle_endtag(self, tag):
        if tag.lower() != "div" or not self.stack:
            return
        kind_key = self.stack.pop()
        if kind_key == "other":
            return
        kind, element_id = kind_key.split(":", 1)
        key = re.sub(r"-(days|time)_data$", "", element_id)
        value = self._trim(self._consume(kind, key))
        if not value:
            return
        if kind == "days":
            self.days_map.setdefault(key, []).append(value)
        elif kind == "time":
            self.time_map.setdefault(key, []).append(value)

    def handle_data(self, data):
        if not self.stack:
            return
        kind_key = self.stack[-1]
        if kind_key == "other":
            return
        kind, element_id = kind_key.split(":", 1)
        key = re.sub(r"-(days|time)_data$", "", element_id)
        if kind == "days":
            self._day_buf.setdefault(key, "")
            self._day_buf[key] += data
        elif kind == "time":
            self._time_buf.setdefault(key, "")
            self._time_buf[key] += data

    def _consume(self, kind: str, key: str) -> str:
        if kind == "days":
            value = self._day_buf.get(key, "")
            self._day_buf[key] = ""
            return value
        value = self._time_buf.get(key, "")
        self._time_buf[key] = ""
        return value


def fetch_schedule(area_code: str, catalog_no: str, class_no: str, path: str, *, is_root=True, section_group="A8"):
    model = {
        "Term": "261",
        "SubjectAreaCode": area_code,
        "CatalogNumber": normalize_catalog(catalog_no),
        "IsRoot": is_root,
        "SessionGroup": section_group,
        "ClassNumber": class_no or "%",
        "SequenceNumber": None,
        "Path": path,
        "MultiListedClassFlag": "n",
    }
    params = {
        "model": json.dumps(model, separators=(",", ":"), ensure_ascii=False),
        "FilterFlags": json.dumps(FILTER_FLAGS, separators=(",", ":"), ensure_ascii=False),
        "_": str(int(time_module.time() * 1000)),
    }
    r = requests.get(URL, params=params, timeout=30)
    if r.status_code != 200:
        return "", ""

    parser = DayTimeParser()
    parser.feed(r.text)
    days_map = parser.days_map
    time_map = parser.time_map
    pairs = []
    for key in sorted(set(days_map) | set(time_map)):
        d = normalize_text(" ".join(days_map.get(key, [])))
        t = normalize_text(" ".join(time_map.get(key, [])))
        if not d or not t:
            continue
        match = TIME_RE.search(t)
        if not match:
            continue
        start, end = parse_time_value(match)
        pairs.append((d, f"{start} - {end}"))
    if not pairs:
        return "", ""
    # prefer explicit non-asynchronous time entries
    for day, times in pairs:
        if times and "TBA" not in times.upper():
            return day, times
    return pairs[0]


def main() -> None:
    with INPUT_CSV.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    out_rows = []
    for row in rows:
        area = normalize_code(row.get("SubjectAreaCode", ""))
        catalog = row.get("CatalogNumber", "")
        class_no = row.get("ClassNumber", "%") or "%"
        path = row.get("Path", row.get("course_id", "")) or ""
        if path:
            days, time_value = fetch_schedule(
                area, catalog, class_no, path, is_root=False if row.get("IsRoot", "False") in {"False", "false", ""} else row.get("IsRoot") in {"true", "True", "TRUE"}, section_group=row.get("SessionGroup", "A8") or "A8"
            )
        else:
            days, time_value = "", ""
        row["days"] = normalize_text(days)
        row["time"] = normalize_text(time_value)
        out_rows.append(row)

    with OUTPUT_CSV.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(out_rows)


if __name__ == "__main__":
    main()
