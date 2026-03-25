#!/usr/bin/env python3
"""
Check whether each course in courses/all_subjects_by_area.csv appears with an Online
section indicator in GetCourseSummary responses.
"""

from __future__ import annotations

import csv
import json
import re
import time
from pathlib import Path

import requests


SOURCE_CSV = Path("courses/all_subjects_by_area.csv")
OUT_CSV = Path("courses/all_subjects_with_online_flag.csv")
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

REQUEST_HEADERS = {
    "accept": "*/*",
    "accept-language": "ko-KR,ko;q=0.9",
    "cache-control": "no-cache",
    "pragma": "no-cache",
    "sec-ch-ua": '"Not:A-Brand";v="99", "Brave";v="145", "Chromium";v="145"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "sec-gpc": "1",
    "x-requested-with": "XMLHttpRequest",
}


def normalize_catalog(raw: str) -> str:
    """
    Convert catalog number to the API format used in the request payload:
    remove whitespace in the original code and right-pad to 8 characters.
    """
    compact = re.sub(r"\s+", "", str(raw).strip())
    return compact.ljust(8)


def make_path(area_code: str, catalog: str) -> str:
    # COM SCI -> COMSCI, C&EE -> C&EE, etc.
    return f"{area_code.replace(' ', '')}{catalog.strip()}A8"


def has_online_button(text: str) -> int:
    return 1 if '<button class="popover-bottom linkLikeButton"' in text else 0


def check_row(row: dict[str, str]) -> int:
    area_code = row.get("subj_area_cd", "")
    catalog_raw = row.get("crs_catlg_no", "")
    class_no = row.get("class_no", "%") or "%"

    catalog = normalize_catalog(catalog_raw)
    path = make_path(area_code, catalog)
    model = {
        "Term": "261",
        "SubjectAreaCode": area_code,
        "CatalogNumber": catalog,
        "IsRoot": True,
        "SessionGroup": "A8",
        "ClassNumber": class_no,
        "SequenceNumber": None,
        "Path": path,
        "MultiListedClassFlag": "n",
    }

    params = {
        "model": json.dumps(model, separators=(",", ":"), ensure_ascii=False),
        "FilterFlags": json.dumps(FILTER_FLAGS, separators=(",", ":"), ensure_ascii=False),
        "_": str(int(time.time() * 1000)),
    }

    try:
        r = requests.get(URL, params=params, headers=REQUEST_HEADERS, timeout=30)
        if r.status_code != 200:
            return 0
        return has_online_button(r.text)
    except Exception:
        return 0


def main() -> None:
    if not SOURCE_CSV.exists():
        raise FileNotFoundError(f"{SOURCE_CSV} not found")

    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with SOURCE_CSV.open(encoding="utf-8-sig", newline="") as f_in, OUT_CSV.open(
        "w", encoding="utf-8-sig", newline=""
    ) as f_out:
        reader = csv.DictReader(f_in)
        writer = csv.writer(f_out)
        writer.writerow(["과목구분", "subj_area_cd", "label", "crs_catlg_no", "class_no", "online_flag"])

        for row in reader:
            row_flag = check_row(row)
            writer.writerow(
                [
                    row.get("과목구분", ""),
                    row.get("subj_area_cd", ""),
                    row.get("label", ""),
                    row.get("crs_catlg_no", ""),
                    row.get("class_no", ""),
                    row_flag,
                ]
            )


if __name__ == "__main__":
    main()
