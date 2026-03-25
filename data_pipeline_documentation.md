# 코드베이스 Raw Data 정리/크롤링 정리 문서

## 1) 현재 기준 요약
- 목표: UCI, UCB, UCLA 강의 데이터에서 과목명/코드/요일/시간/교수/학점/온라인 여부를 추출해 비교 가능한 형태로 정렬
- 방식: 원본 텍스트/HTML(raw dump) → 파서 추출 → 학교별 공통 스키마 정렬 → 온라인 필터/분리
- 실행 파이프라인의 최종 산출물은 파일마다 열 구성이 다르므로, 통합 용도에 맞춘 semantic aligned 파일을 별도 관리

## 2) Raw Data 위치와 성격
- `a.txt`
  - UCLA 크롤링 결과로 보이는 HTML/텍스트 블록 원본
- `a/info.txt`
  - `GetLevelSeparatedSearchData` 요청(에피소드 형태)의 네트워크 메타 정보
- `a/response.txt`
  - UCLA `GetLevelSeparatedSearchData` 응답 샘플
- `ucla_courses_api_all_blocks.csv`
  - UCLA API 응답의 블록 단위(강의/시간/장소/요약 플래그) 기반 추출 결과
- `uci.txt`
  - UCI 공개 수업표(탭 구분 텍스트, `Dept. & Num.` 헤더 형태)
- `ei.txt`
  - UCB/또는 EI 스타일 블록 텍스트(과목 제목/섹션/날짜/요일/시간 패턴)
- `courses/courses.csv`는 현재 저장소에 존재하지만 3열(과목명,과목번호,이수학점) 스키마이며, `extract_ei_subjects.py` 기본 출력(7열)과는 다르게 보임(과거 산출물/후가공 산출물일 가능성 높음)
- `a_extracted_courses.csv`, `a_extracted_courses_with_schedule.csv`
  - UCLA 코드/토큰/세션 정보를 담은 추출물로 보이며, 파싱 직후 중간 산출물 성격

## 3) 크롤링/추출 스크립트

### 3-1) `collect_subject_areas.py`
- 용도: UCLA 학부군별 과목 리스트 수집
- 엔드포인트: `https://sa.ucla.edu/ro/ClassSearch/Public/Search/GetLevelSeparatedSearchData`
- 요청 파라미터 핵심:
  - `search_by=subject`
  - `term_cd=261`
  - `ses_grp_cd=A8`
  - `input` JSON에 `{"search_by":"subject","term_cd":"261","subj_area_cd":"..."}` 형태
- 하드코딩된 subject area 목록 (`AREA_LINES`)에 대해 순회 수집
- 산출물: `courses/all_subjects_by_area.csv`
- 스키마: `과목구분,subj_area_cd,label,crs_catlg_no,class_no`

### 3-2) `check_online_flags.py`
- 용도: `courses/all_subjects_by_area.csv` 각 과목의 온라인 여부 점검
- 엔드포인트: `https://sa.ucla.edu/ro/public/soc/Results/GetCourseSummary`
- 요청 파라미터:
  - `model`: `Term`, `SubjectAreaCode`, `CatalogNumber`, `ClassNumber`, `Path`, `SessionGroup=A8` 등
  - `FilterFlags`: enrollment/status, 시간/요일 필터, summer_session=A08 등 고정값
- 온라인 판정 기준: 응답 텍스트 내  
  `'<button class="popover-bottom linkLikeButton"'` 문자열 존재 여부(있으면 1, 없으면 0)
- 산출 예정 파일:
  - `courses/all_subjects_with_online_flag.csv`
- 현재 상태: 스크립트가 이 파일을 생성하도록 작성되어 있으나 저장소 루트에는 현재 미존재

### 3-3) `enrich_zero_subjects_schedule.py`
- 용도: 온라인 판정 후에도 스케줄이 없는 항목(이론적으로는 `courses/all_subjects_with_online_flag_zero.csv`)의 요일/시간 보강
- 엔드포인트: `GetCourseSummary` 재사용
- HTML 파싱 대상:
  - `*-days_data` div
  - `*-time_data` div
- 판독 결과를 `days`, `times`로 집계해 컬럼 `날짜(일단 days)`, `시간(세미콜론 구분)` 형태로 병합
- 산출 예정 파일:
  - `courses/all_subjects_with_online_flag_zero_with_schedule.csv`
- 현재 상태: 현재 파일들은 저장소에서 확인되지 않음

### 3-4) `extract_ei_subjects.py`
- 용도: EI/UCI 텍스트를 공통 필드로 파싱
- 입력 기본값:
  - `ei.txt` (`python extract_ei_subjects.py ei.txt`)
  - 출력 기본값: `courses/courses.csv`
- 파싱 분기:
  - UCI 스타일: `Dept. & Num.` 및 `Course Title` 헤더가 존재하면 탭 분해 모드
  - EI 스타일: `How to apply` 블록 분리 후 `offered through`, 날짜 라인, 요일 라인, 시간 라인 탐지
- 공통 추출:
  - 과목명, 과목번호, 이수학점, 교수명, 시작시간, 종료시간, 날짜
- 온라인 제외 규칙:
  - 제목/코스명에 `(on-line)` 포함이면 스킵
- 시간 정규화:
  - `9:30 am - 10:59 am` 같은 입력을 `9:30AM` / `10:59AM`로 정규화

## 4) 학교별 정제/정렬 기준

### UCI (`uci.txt` 기반)
- 시간/요일 파싱은 `Day/Time` 필드에서 직접 추출
- `@ @` 또는 `On-Line` 표기 등 명시적 온라인 수업은 별도 필터링 대상
- `start_time`/`end_time`은 `AM/PM` 유지, 공백 제거, 한 개 과목이 여러 라인일 경우 한 행씩 취급

### UCB (`ei.txt` 기반)
- 과목명, 날짜, 요일(Mo,Tu...), 시간(시간범위) 규칙으로 행 추출
- `(on-line)` 포함 제목 제거
- 날짜/요일은 문자열로 유지해 비교/시각화 시 추가 정규화가 필요할 수 있음

### UCLA (`a.txt` + API)
- 첫 단계는 `GetLevelSeparatedSearchData`로 과목 후보 수집
- 항목 상세는 `GetCourseSummary` 또는 `ucla_courses_api_all_blocks.csv` 기반 blocks에서 시간/장소/요약 데이터 추출
- 온라인 판정은 버튼 marker + location 문자열(`Online`, `Online - Asynchronous`) 혼합 방식으로 이뤄짐
- `source_label`에서 코드 prefix 제거(예: `596 - ...` → `...`)와 같이 과목명 정리된 semantic 버전이 존재

## 5) 현재 저장소에 있는 산출물(정렬/필터 관점)
- `courses/all_subjects_by_area.csv`: UCLA 과목군별 후보 목록(시드 데이터)
- `courses/uci_courses.csv`, `courses/ucb_courses.csv`, `courses/ucla_courses.csv`: 학교별 기본 추출 결과
- `courses/uci_courses_aligned.csv`, `courses/ucb_courses_aligned.csv`, `courses/ucla_courses_aligned.csv`: aligned 전 단계(순서 맞춤/공통 형태로 재배열)
- `courses/uci_courses_semantic_aligned.csv`, `courses/ucb_courses_semantic_aligned.csv`, `courses/ucla_courses_semantic_aligned.csv`: semantic aligned 버전(공통 분석/비교용)
- `courses/ucla_courses_api_all_blocks.csv`: UCLA API 블록 원본 수집본
- `courses/ucla_courses_api_online_semantic_aligned.csv`, `courses/ucla_courses_api_offline_semantic_aligned.csv`: 온라인/오프라인 API 기반 분리
- `courses/ucla_courses_with_online_word.csv`, `courses/ucla_courses_without_online_word.csv`, `courses/ucla_courses_without_async.csv`: 온라인 키워드 기반 분류/제외 파일
- `a_extracted_courses.csv`, `a_extracted_courses_with_schedule.csv`: UCLA token/sections 기반 추출 중간 산출물

## 6) 주의/한계
- UTF-8 스크립트 헤더가 일부 소스에서 깨져(한글 헤더가 `\u` 형태로 노출) 있어 저장형식 확인이 중요
- `check_online_flags.py`, `enrich_zero_subjects_schedule.py`가 기대하는 입력/출력 CSV(`all_subjects_with_online_flag*`)는 현재 존재하지 않아, 문서 기준으로는 “재생성 가능” 상태로 다루는 것이 맞음
- `courses/courses.csv`는 현재 저장소 내용과 `extract_ei_subjects.py` 기본 출력 스키마가 다르므로, 동일 파일이라도 재실행 시 컬럼 수 변화 가능
