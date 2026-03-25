#!/usr/bin/env python3
"""
Add day/time fields to courses/all_subjects_with_online_flag_zero.csv using
GetCourseSummary response blocks:
- ...-days_data
- ...-time_data
"""

from __future__ import annotations

import csv
import html
import json
import re
import time
from html.parser import HTMLParser
from pathlib import Path

import requests


SOURCE = Path("courses/all_subjects_with_online_flag_zero.csv")
OUTPUT = Path("courses/all_subjects_with_online_flag_zero_with_schedule.csv")

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


class DayTimeParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[tuple[str | None, str]] = []
        self.days: dict[str, set[str]] = {}
        self.times: dict[str, set[str]] = {}

    @staticmethod
    def _trim(text: str) -> str:
        return re.sub(r"\s+", " ", text).strip()

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        if tag.lower() != "div":
            return
        id_attr = attrs_dict.get("id", "")
        if id_attr.endswith("-days_data"):
            self.stack.append(("days", id_attr))
            return
        if id_attr.endswith("-time_data"):
            self.stack.append(("time", id_attr))
            return
        self.stack.append((None, id_attr))

    def handle_endtag(self, tag):
        if tag.lower() != "div":
            return
        if not self.stack:
            return
        kind, id_attr = self.stack.pop()
        if kind in {"days", "time"}:
            key = re.sub(r"-(days|time)_data$", "", id_attr)
            data = self._trim(self.current_buf)
            if data:
                if kind == "days":
                    self.days.setdefault(key, set()).add(data)
                else:
                    self.times.setdefault(key, set()).add(data)

    @property
    def current_type(self):
        return self.stack[-1][0] if self.stack else None

    @property
    def current_buf(self):
        # not ideal; use stack mutation for speed and simplicity below
        pass

    def handle_data(self, data):
        if not self.stack:
            return
        kind, id_attr = self.stack[-1]
        if kind not in {"days", "time"}:
            return
        self._push_data(id_attr, kind, data)

    def handle_startendtag(self, tag, attrs):
        pass

    def handle_entityref(self, name):
        if not self.stack:
            return
        kind, id_attr = self.stack[-1]
        if kind not in {"days", "time"}:
            return
        self._push_data(id_attr, kind, html.entities.codepoint2name.get(name, f"&{name};"))

    def _push_data(self, id_attr: str, kind: str, text: str):
        key = re.sub(r"-(days|time)_data$", "", id_attr)
        container = self.days if kind == "days" else self.times
        current = " ".join(self._tokenize(getattr(self, f"_accum_{kind}_", {}).get(key, "")))
        # handled below by dedicated accumulators

    def parse(self, html_text: str):
        self._accum_days: dict[str, list[str]] = {}
        self._accum_time: dict[str, list[str]] = {}
        # reset stack and parse
        self.stack = []
        class DayTimeInnerParser(HTMLParser):
            def __init__(self, outer):
                super().__init__(convert_charrefs=True)
                self.outer = outer
            def handle_starttag(self, tag, attrs):
                attrs_dict = dict(attrs)
                if tag.lower() != "div":
                    return
                id_attr = attrs_dict.get("id", "")
                if id_attr.endswith("-days_data"):
                    self.outer.stack.append(("days", id_attr))
                    return
                if id_attr.endswith("-time_data"):
                    self.outer.stack.append(("time", id_attr))
                    return
                self.outer.stack.append((None, id_attr))
            def handle_endtag(self, tag):
                if tag.lower() != "div":
                    return
                if not self.outer.stack:
                    return
                kind, id_attr = self.outer.stack.pop()
                if kind in {"days", "time"}:
                    key = re.sub(r"-(days|time)_data$", "", id_attr)
                    data = DayTimeParser._trim(self.outer._consume_text(kind, key))
                    if data:
                        target = self.outer.days if kind == "days" else self.outer.times
                        target.setdefault(key, set()).add(data)
            def handle_data(self, data):
                kind, id_attr = self.outer.stack[-1] if self.outer.stack else (None, "")
                if kind not in {"days", "time"}:
                    return
                key = re.sub(r"-(days|time)_data$", "", id_attr)
                if kind == "days":
                    self.outer._append(kind, key, data)
                elif kind == "time":
                    self.outer._append(kind, key, data)
            def handle_starttag_button(self, tag, attrs):
                pass
            def handle_entityref(self, name):
                self.handle_data("&%s;" % name)
        parser = DayTimeInnerParser(self)
        parser.feed(html_text)
        return self.days, self.times

    def _append(self, kind: str, key: str, text: str):
        if kind == "days":
            self._accum_days.setdefault(key, []).append(text)
        else:
            self._accum_time.setdefault(key, []).append(text)

    def _consume_text(self, kind: str, key: str) -> str:
        if kind == "days":
            text = "".join(self._accum_days.get(key, []))
            self._accum_days[key] = []
            return text
        text = "".join(self._accum_time.get(key, []))
        self._accum_time[key] = []
        return text


def normalize_catalog(raw: str) -> str:
    compact = re.sub(r"\s+", "", str(raw).strip())
    return compact.ljust(8)


def build_path(area_code: str, catalog: str) -> str:
    return f"{area_code.replace(' ', '')}{catalog}A8"


def extract_schedule(area_code: str, catalog_raw: str, class_no: str) -> tuple[str, str]:
    catalog = normalize_catalog(catalog_raw)
    model = {
        "Term": "261",
        "SubjectAreaCode": area_code,
        "CatalogNumber": catalog,
        "IsRoot": True,
        "SessionGroup": "A8",
        "ClassNumber": class_no or "%",
        "SequenceNumber": None,
        "Path": build_path(area_code, catalog),
        "MultiListedClassFlag": "n",
    }
    params = {
        "model": json.dumps(model, separators=(",", ":"), ensure_ascii=False),
        "FilterFlags": json.dumps(FILTER_FLAGS, separators=(",", ":"), ensure_ascii=False),
        "_": str(int(time.time() * 1000)),
    }
    try:
        r = requests.get(URL, params=params, timeout=30)
    except Exception:
        return "", ""
    if r.status_code != 200:
        return "", ""

    text = r.text
    parser = DayTimeParser()
    days_map, time_map = parser.parse(text)
    day_values = []
    time_values = []
    for key in sorted(set(days_map.keys()) | set(time_map.keys())):
        d = sorted(days_map.get(key, []))
        t = sorted(time_map.get(key, []))
        if d:
            day_values.extend(d)
        if t:
            # keep only non-empty times
            time_values.extend([x for x in t if x])
    # dedupe preserve order
    day_values = list(dict.fromkeys(day_values))
    time_values = list(dict.fromkeys(time_values))
    return ",".join(day_values), ";".join(time_values)


def main() -> None:
    with SOURCE.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    if not rows:
        return

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        fieldnames = [
            "과목구분",
            "subj_area_cd",
            "label",
            "crs_catlg_no",
            "class_no",
            "online_flag",
            "요일",
            "시간",
        ]
        writer.writerow(fieldnames)
        for row in rows:
            days, times = extract_schedule(
                row.get("subj_area_cd", ""),
                row.get("crs_catlg_no", ""),
                row.get("class_no", "%") or "%",
            )
            writer.writerow(
                [
                    row.get("과목구분", ""),
                    row.get("subj_area_cd", ""),
                    row.get("label", ""),
                    row.get("crs_catlg_no", ""),
                    row.get("class_no", ""),
                    row.get("online_flag", ""),
                    days,
                    times,
                ]
            )


if __name__ == "__main__":
    main()
