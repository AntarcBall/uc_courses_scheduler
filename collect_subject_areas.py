#!/usr/bin/env python3
"""
Send GetLevelSeparatedSearchData requests for multiple subj_area_cd values and
merge all responses into a single CSV.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

import requests


URL = "https://sa.ucla.edu/ro/ClassSearch/Public/Search/GetLevelSeparatedSearchData"

AREA_LINES = [
    "Bioengineering (BIOENGR)",
    "Civil and Environmental Engineering (C&EE)",
    "Classics (CLASSIC)",
    "Community Health Sciences (COM HLT)",
    "Computer Science (COM SCI)",
    "Electrical and Computer Engineering (EC ENGR)",
    "Engineering (ENGR)",
    "French (FRNCH)",
    "Greek",
    "Hebrew",
    "Latin",
    "Materials Science and Engineering (MAT SCI)",
    "Mechanical and Aerospace Engineering (MECH&AE)",
    "Music Industry (MSC IND)",
    "Program in Computing (COMPTNG)",
    "Psychiatry and Biobehavioral Sciences (PSYCTRY)",
    "Russian (RUSSN)",
]


def parse_area(line: str) -> tuple[str, str]:
    if "(" in line and ")" in line:
        name, code = line.rsplit("(", 1)
        return name.strip(), code[:-1].strip()
    return line.strip(), "".join(ch for ch in line.strip() if ch != " ").upper()


def fetch_subjects(area_code: str):
    payload = {
        "search_by": "subject",
        "term_cd": "261",
        "subj_area_cd": area_code,
        "ses_grp_cd": "A8",
    }
    params = {
        "input": json.dumps(payload, separators=(",", ":")),
        "level": "2",
    }
    headers = {
        "accept": "*/*",
        "accept-language": "ko-KR,ko;q=0.9",
        "x-requested-with": "XMLHttpRequest",
    }
    r = requests.get(URL, params=params, headers=headers, timeout=30)
    r.raise_for_status()
    data = r.json()
    if not isinstance(data, list):
        return []
    rows = []
    for item in data:
        if not isinstance(item, dict):
            continue
        value = item.get("value", {})
        if not isinstance(value, dict):
            continue
        rows.append(
            (
                item.get("label", ""),
                str(value.get("crs_catlg_no", "")),
                str(value.get("class_no", "")),
            )
        )
    return rows


def main() -> None:
    rows = []
    for line in AREA_LINES:
        name, code = parse_area(line)
        try:
            for label, crs_catlg_no, class_no in fetch_subjects(code):
                rows.append(
                    [name, code, label, crs_catlg_no, class_no]
                )
        except Exception:
            rows.append([name, code, "ERROR", "", ""])

    out = Path("courses/all_subjects_by_area.csv")
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(["과목구분", "subj_area_cd", "label", "crs_catlg_no", "class_no"])
        writer.writerows(rows)


if __name__ == "__main__":
    main()
