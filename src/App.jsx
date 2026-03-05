import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "course-dashboard-selection-v1";
const SLOT_MINUTES = 30;
const MIN_ROW_HEIGHT = 42;
const TIMETABLE_START_MINUTE = 7 * 60;
const TIMETABLE_END_MINUTE = 19 * 60;

const DAY_ORDER = ["M", "Tu", "W", "Th", "F"];
const DAY_LABELS = {
  M: "Mon",
  Tu: "Tue",
  W: "Wed",
  Th: "Thu",
  F: "Fri",
};

const DAY_ALIASES = {
  M: "M",
  MO: "M",
  TU: "Tu",
  T: "Tu",
  W: "W",
  WE: "W",
  TH: "Th",
  R: "Th",
  F: "F",
  FR: "F",
};

function normalizeDayForKey(day) {
  return DAY_ALIASES[day] || day || "";
}

function getCourseTimeSignature(course) {
  if (!course || !Array.isArray(course.sessions) || course.sessions.length === 0) {
    return "";
  }

  const slots = course.sessions
    .map((session) => ({
      day: normalizeDayForKey(session.day),
      start: session.startMinute,
      end: session.endMinute,
    }))
    .filter(
      (slot) =>
        slot.day &&
        Number.isFinite(slot.start) &&
        Number.isFinite(slot.end) &&
        slot.start >= 0 &&
        slot.end >= slot.start
    )
    .sort((a, b) => {
      const dayDelta = DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day);
      if (dayDelta !== 0) {
        return dayDelta;
      }
      if (a.start !== b.start) {
        return a.start - b.start;
      }
      return a.end - b.end;
    });

  if (slots.length === 0) {
    return "";
  }

  return slots
    .map((slot) => `${slot.day}|${slot.start}|${slot.end}`)
    .join(";");
}

function dedupeCoursesByTime(courses) {
  const seen = new Set();
  return (courses || []).filter((course) => {
    const key = getCourseTimeSignature(course);
    if (!key) {
      return true;
    }
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

const SCHOOL_TABS = [
  { id: "UCI", label: "UCI" },
  { id: "UCB", label: "UCB" },
  { id: "UCLA", label: "UCLA" },
];

const DATA_URLS = {
  uciCsv: "/data/uci_courses.csv",
  ucbCsv: "/data/ucb_courses.csv",
  uclaCsv: "/data/ucla_courses.csv",
  uclaApi: "/data/ucla_courses_api_all_blocks.csv",
  uciRaw: "/data/uci.txt",
  ucbRaw: "/data/ei.txt",
};

function normalizeText(value) {
  return (value || "").toString().replace(/\s+/g, " ").trim();
}

function normalizeCode(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function normalizeMapKey(...parts) {
  return normalizeText(parts.join("|"))
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let insideQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (insideQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        insideQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      insideQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }

    if (char === "\n") {
      row.push(cell);
      if (row.some((item) => item !== "")) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }

    if (char === "\r") {
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((item) => item !== "")) {
      rows.push(row);
    }
  }

  if (!rows.length) {
    return [];
  }

  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, "").trim());
  return rows.slice(1).map((line) => {
    const item = {};
    headers.forEach((header, idx) => {
      item[header] = line[idx] ?? "";
    });
    return item;
  });
}

function parseTimeMinutes(rawTime) {
  const cleaned = normalizeText(rawTime)
    .replace(/<[^>]*>/g, "")
    .replace(/\./g, "")
    .toUpperCase();
  const m = cleaned.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/);
  if (!m) {
    return null;
  }

  const hour = Number(m[1]);
  const minute = Number(m[2] ?? "00");
  const meridiem = m[3];

  if (
    hour < 1 ||
    hour > 12 ||
    Number.isNaN(hour) ||
    Number.isNaN(minute) ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  let normalizedHour = hour;
  if (meridiem === "PM" && hour !== 12) {
    normalizedHour = hour + 12;
  }
  if (meridiem === "AM" && hour === 12) {
    normalizedHour = 0;
  }

  return normalizedHour * 60 + minute;
}

function parseTimeRange(rawTime) {
  const cleaned = normalizeText(rawTime)
    .replace(/<[^>]*>/g, " ")
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const m = cleaned.match(
    /(\d{1,2}(?::\d{2})?\s*(?:A\.M\.?|P\.M\.?|AM|PM))\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:A\.M\.?|P\.M\.?|AM|PM))/i
  );
  if (!m) {
    return null;
  }

  const start = parseTimeMinutes(m[1]);
  const end = parseTimeMinutes(m[2]);
  if (start == null || end == null || end <= start) {
    return null;
  }

  return { start, end };
}

function mapDayAlias(token) {
  const t = token.toUpperCase();
  return DAY_ALIASES[t] ?? null;
}

function expandDayToken(token) {
  const raw = normalizeText(token).toUpperCase().replace(/\s+/g, "");
  if (!raw) {
    return [];
  }

  const exactAlias = {
    MON: "M",
    MONDAY: "M",
    M: "M",
    MO: "M",
    TUE: "Tu",
    TUESDAY: "Tu",
    TU: "Tu",
    T: "Tu",
    WED: "W",
    WEDNESDAY: "W",
    WE: "W",
    W: "W",
    THU: "Th",
    THURSDAY: "Th",
    TH: "Th",
    R: "Th",
    FRI: "F",
    FRIDAY: "F",
    FR: "F",
    F: "F",
    SAT: "",
    SATURDAY: "",
    SU: "",
    SUN: "",
    SUNDAY: "",
  };

  if (raw.includes(",")) {
    return dedupe(
      raw
        .split(",")
        .flatMap((part) => expandDayToken(part))
        .filter(Boolean)
    );
  }

  if (raw.includes("-")) {
    const parts = raw.split("-").map((part) => part.trim()).filter(Boolean);
    return dedupe(parts.flatMap((part) => expandDayToken(part)).filter(Boolean));
  }

  if (exactAlias[raw] !== undefined) {
    return exactAlias[raw] ? [exactAlias[raw]] : [];
  }

  const out = [];
  for (let i = 0; i < raw.length; ) {
    const three = raw.slice(i, i + 3);
    const mappedThree = exactAlias[three];
    if (mappedThree !== undefined) {
      if (!mappedThree) {
        return [];
      }
      out.push(mappedThree);
      i += 3;
      continue;
    }

    const pair = raw.slice(i, i + 2);
    const mappedPair = exactAlias[pair] || mapDayAlias(pair);
    if (mappedPair) {
      out.push(mappedPair);
      i += 2;
      continue;
    }

    const single = mapDayAlias(raw[i]);
    if (single) {
      out.push(single);
      i += 1;
      continue;
    }

    return [];
  }

  return dedupe(out);
}

function dedupe(values) {
  const set = new Set();
  const out = [];
  values.forEach((value) => {
    if (!value || set.has(value)) {
      return;
    }
    set.add(value);
    out.push(value);
  });
  return out;
}

function parseDayAndTimes(dayText, timeText) {
  const dayList = expandDayToken(dayText);
  if (!dayList.length) {
    return [];
  }

  const parsedTime = parseTimeRange(timeText);
  if (!parsedTime) {
    return [];
  }

  return dayList.map((day) => ({
    day,
    start: parsedTime.start,
    end: parsedTime.end,
  }));
}

function parseDayTimeExpression(value) {
  const normalized = normalizeText(value).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }

  const matchTime = normalized.match(
    /(\d{1,2}(?::\d{2})?\s*(?:A\.M\.?|P\.M\.?|AM|PM)\s*(?:-|–|—|to)\s*\d{1,2}(?::\d{2})?\s*(?:A\.M\.?|P\.M\.?|AM|PM))/i
  );
  if (!matchTime) {
    return [];
  }

  const timeText = matchTime[0];
  const dayText = normalized.substring(0, matchTime.index).trim();
  if (!dayText) {
    return [];
  }

  return parseDayAndTimes(dayText, timeText);
}

function mergeSessions(list) {
  const uniq = new Map();
  list.forEach((s) => {
    const key = `${s.day}-${s.start}-${s.end}`;
    if (!uniq.has(key)) {
      uniq.set(key, s);
    }
  });
  return [...uniq.values()].sort((a, b) => {
    if (a.day !== b.day) {
      return DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day);
    }
    return a.start - b.start;
  });
}

function addToMap(map, key, sessions) {
  if (!sessions.length) {
    return;
  }
  const existing = map.get(key) || [];
  map.set(key, mergeSessions([...existing, ...sessions]));
}

function parseUciRawSchedule(rawText) {
  const map = new Map();
  const lines = rawText.split(/\r?\n/);
  let inBody = false;

  for (const line of lines) {
    const trimmed = normalizeText(line);
    if (!trimmed) {
      continue;
    }

    if (trimmed.includes("Dept. & Num.") && trimmed.includes("Course Title")) {
      inBody = true;
      continue;
    }

    if (!inBody) {
      continue;
    }

    const columns = line.split("\t");
    if (columns.length < 9) {
      continue;
    }

    const code = normalizeText(columns[1]);
    const title = normalizeText(columns[8]);
    const dayTime = normalizeText(columns[7]);
    const sessions = parseDayTimeExpression(dayTime);

    if (!code || !title || !sessions.length || /@ @/i.test(dayTime)) {
      continue;
    }

    const keyByBoth = normalizeMapKey(code, title);
    const keyByCode = normalizeMapKey(code);
    addToMap(map, keyByBoth, sessions);
    addToMap(map, keyByCode, sessions);
  }

  return map;
}

function parseUciCourses(rawCsv, scheduleMap) {
  const rows = parseCsv(rawCsv);
  return rows
    .map((row, idx) => {
      const values = Object.values(row);
      const name = normalizeText(values[0] ?? "");
      const code = normalizeText(values[1] ?? "");
      const credit = normalizeText(values[2] ?? "");
      const instructor = normalizeText(values[3] ?? "");
      const start = normalizeText(values[4] ?? "");
      const end = normalizeText(values[5] ?? "");

      const sessions =
        scheduleMap.get(normalizeMapKey(code, name)) ||
        scheduleMap.get(normalizeMapKey(code)) ||
        [];

      return {
        id: `UCI::${normalizeMapKey(code)}::${idx}`,
        university: "UCI",
        name,
        code,
        credit,
        instructor,
        fallbackTime: start && end ? `${start} - ${end}` : "",
        sessions,
      };
    })
    .filter((item) => item.name);
}

function parseEiCodeFromHeader(line) {
  const base = normalizeText(line.split(/offered through/i)[0]);
  if (!base) {
    return "";
  }

  const chunks = base.split(" - ");
  const hasTerminalCode = (token) => {
    const last = token.split(" ").pop();
    return !!last && /\d/.test(last) && /[A-Za-z]/.test(token);
  };

  for (let i = chunks.length - 2; i >= 0; i -= 1) {
    let token = normalizeText(chunks[i]);
    if (!token) {
      continue;
    }

    token = token.replace(/^[A-Za-z]{3,}\s+\d{1,2}(?:\s*-\s*\d{1,2})?\s+/i, "").trim();
    if (!token || !hasTerminalCode(token)) {
      continue;
    }

    return token;
  }

  const fallback = chunks.length ? normalizeText(chunks[0]) : "";
  return hasTerminalCode(fallback) ? fallback : "";
}

function parseUcbDayLine(line) {
  const normalized = normalizeText(line).replace(/\s+/g, " ");
  const items = normalized
    .split(",")
    .map((item) => normalizeText(item))
    .filter(Boolean);
  if (!items.length) {
    return [];
  }

  const all = [];
  for (const item of items) {
    const parsed = expandDayToken(item);
    if (!parsed.length) {
      return [];
    }
    all.push(...parsed);
  }

  return dedupe(all);
}

function parseEiCourseTitle(lines, start) {
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = normalizeText(lines[i]);
    if (!line) {
      continue;
    }

    if (/^(section closed|time conflict enrollment allowed)$/i.test(line)) {
      continue;
    }

    if (/^Units:/i.test(line)) {
      break;
    }

    if (/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.test(line)) {
      continue;
    }

    if (parseUcbDayLine(line).length > 0) {
      continue;
    }

    if (/\d{1,2}:\d{2}\s*[AP]M\s*-\s*\d{1,2}:\d{2}\s*[AP]M/i.test(line)) {
      continue;
    }

    return line;
  }

  return "";
}

function parseUcbRawSchedule(rawText) {
  const chunks = rawText.split(/How to apply/i);
  const map = new Map();
  const timeReg =
    /(\d{1,2}(?::\d{2})?\s*(?:A\.M\.?|P\.M\.?|AM|PM))\s*-\s*(\d{1,2}(?::\d{2})?\s*(?:A\.M\.?|P\.M\.?|AM|PM))/i;

  for (const chunk of chunks) {
    const lines = chunk
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (!lines.length) {
      continue;
    }

    const headerIdx = lines.findIndex((line) => /offered through/i.test(line));
    if (headerIdx < 0) {
      continue;
    }

    const code = normalizeCode(parseEiCodeFromHeader(lines[headerIdx]));
    if (!code) {
      continue;
    }

    const title = parseEiCourseTitle(lines, headerIdx);
    if (!title) {
      continue;
    }

    const dayLine = lines.slice(headerIdx + 1).find((line) => parseUcbDayLine(line).length > 0);
    const timeLine = lines
      .slice(headerIdx + 1)
      .find((line) => timeReg.test(line));

    if (!dayLine || !timeLine) {
      continue;
    }

    const match = timeLine.match(timeReg);
    if (!match) {
      continue;
    }

    const dayTokens = parseUcbDayLine(dayLine);
    const start = parseTimeMinutes(match[1]);
    const end = parseTimeMinutes(match[2]);

    if (!dayTokens.length || start == null || end == null || end <= start) {
      continue;
    }

    const sessions = dayTokens.map((day) => ({ day, start, end }));
    const keyByCode = normalizeMapKey(code);
    const keyByBoth = normalizeMapKey(code, title);
    addToMap(map, keyByCode, sessions);
    addToMap(map, keyByBoth, sessions);
  }

  return map;
}

function parseUcbCourses(rawCsv, scheduleMap) {
  const rows = parseCsv(rawCsv);
  return rows
    .map((row, idx) => {
      const values = Object.values(row);
      const name = normalizeText(values[0] ?? "");
      const code = normalizeCode(values[1] ?? "");
      const credit = normalizeText(values[2] ?? "");
      const instructor = normalizeText(values[3] ?? "");
      const start = normalizeText(values[4] ?? "");
      const end = normalizeText(values[5] ?? "");
      const titleKey = normalizeMapKey(code, name);
      const sessions = scheduleMap.get(titleKey) || scheduleMap.get(code) || [];

      return {
        id: `UCB::${code}::${idx}`,
        university: "UCB",
        name,
        code,
        credit,
        instructor,
        fallbackTime: start && end ? `${start} - ${end}` : "",
        sessions,
      };
    })
    .filter((item) => item.name);
}

function normalizeUclaLabel(raw) {
  const title = normalizeText(raw);
  const firstSep = title.indexOf(" - ");
  return firstSep < 0 ? title : title.slice(firstSep + 3).trim();
}

function parseUclaApiSchedule(rawText) {
  const rows = parseCsv(rawText);
  const map = new Map();

  for (const row of rows) {
    const area = normalizeCode(row.subj_area_cd);
    const code = normalizeCode(row.source_crs_catlg_no);
    const days = normalizeText(row.days);
    const time = normalizeText(row.time);

    if (!area || !code || !days || !time) {
      continue;
    }

    if (/^varies$/i.test(days) || /^varies$/i.test(time) || /not scheduled/i.test(time)) {
      continue;
    }

    const parsed = parseDayTimeExpression(`${days} ${time}`);
    if (!parsed.length) {
      continue;
    }

    addToMap(map, `${area}||${code}`, parsed);
  }

  return map;
}

function parseUclaCourses(rawCsv, apiMap) {
  const rows = parseCsv(rawCsv);
  return rows
    .map((row, idx) => {
      const area = normalizeCode(row.subj_area_cd);
      const code = normalizeCode(row.crs_catlg_no);
      const key = `${area}||${code}`;
      const rawLabel = normalizeText(row.label);

      return {
        id: `UCLA::${normalizeMapKey(area, code)}::${idx}`,
        university: "UCLA",
        name: normalizeUclaLabel(rawLabel),
        code,
        area,
        onlineFlag: normalizeText(row.online_flag),
        credit: "",
        sessions: apiMap.get(key) || [],
      };
    })
    .filter((item) => item.name);
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { UCI: [], UCB: [], UCLA: [] };
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { UCI: [], UCB: [], UCLA: [] };
    }

    return {
      UCI: Array.isArray(parsed.UCI) ? parsed.UCI : [],
      UCB: Array.isArray(parsed.UCB) ? parsed.UCB : [],
      UCLA: Array.isArray(parsed.UCLA) ? parsed.UCLA : [],
    };
  } catch {
    return { UCI: [], UCB: [], UCLA: [] };
  }
}

function sanitizeSelectionState(state, data) {
  const next = { ...state };
  SCHOOL_TABS.forEach((school) => {
    const key = school.id;
    const validIds = new Set((data[key] || []).map((course) => course.id));
    const timeSignatureMap = new Map();

    (data[key] || []).forEach((course) => {
      const signature = getCourseTimeSignature(course);
      if (!signature) {
        return;
      }
      if (!timeSignatureMap.has(signature)) {
        timeSignatureMap.set(signature, course.id);
      }
    });

    const keep = new Set(timeSignatureMap.values());
    const selected = Array.isArray(next[key]) ? next[key] : [];

    next[key] = selected.filter((id) => {
      if (!validIds.has(id)) {
        return false;
      }

      const course = (data[key] || []).find((item) => item.id === id);
      if (!course) {
        return false;
      }

      const signature = getCourseTimeSignature(course);
      if (!signature) {
        return true;
      }

      return keep.has(id);
    });
  });
  return next;
}

function parseAllData() {
  return Promise.all([
    fetch(DATA_URLS.uciCsv).then((res) => res.text()),
    fetch(DATA_URLS.ucbCsv).then((res) => res.text()),
    fetch(DATA_URLS.uclaCsv).then((res) => res.text()),
    fetch(DATA_URLS.uclaApi).then((res) => res.text()),
    fetch(DATA_URLS.uciRaw).then((res) => res.text()),
    fetch(DATA_URLS.ucbRaw).then((res) => res.text()),
  ]).then(([uciCsv, ucbCsv, uclaCsv, uclaApi, uciRaw, ucbRaw]) => {
    const uciScheduleMap = parseUciRawSchedule(uciRaw);
    const ucbScheduleMap = parseUcbRawSchedule(ucbRaw);
    const uclaApiMap = parseUclaApiSchedule(uclaApi);

    return {
      UCI: parseUciCourses(uciCsv, uciScheduleMap),
      UCB: parseUcbCourses(ucbCsv, ucbScheduleMap),
      UCLA: parseUclaCourses(uclaCsv, uclaApiMap),
    };
  });
}

function colorFromId(courseId) {
  let seed = 0;
  for (let i = 0; i < courseId.length; i += 1) {
    seed = (seed * 31 + courseId.charCodeAt(i)) % 360;
  }
  return `hsl(${seed}, 82%, 58%)`;
}

function getCourseBlockBias(courseId) {
  let seed = 0;
  for (let i = 0; i < courseId.length; i += 1) {
    seed = (seed * 131 + courseId.charCodeAt(i)) % 9973;
  }

  return {
    top: (seed % 7) * 4,
    bottom: (Math.floor(seed / 3) % 7) * 4,
    left: (Math.floor(seed / 9) % 6) * 4,
    right: (Math.floor(seed / 15) % 6) * 4,
  };
}

function timeToLabel(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const normalized = h % 12 || 12;
  const meridiem = h >= 12 ? "PM" : "AM";
  return `${normalized}:${m.toString().padStart(2, "0")} ${meridiem}`;
}

function getTimelineRange(courses) {
  const segments = courses.flatMap((course) => course.sessions);
  if (!segments.length) {
    return { start: TIMETABLE_START_MINUTE, end: TIMETABLE_END_MINUTE };
  }

  const starts = segments.map((segment) => segment.start);
  const ends = segments.map((segment) => segment.end);
  const min = Math.min(...starts);
  const max = Math.max(...ends);

  const rangeStart = Math.floor((min - 30) / SLOT_MINUTES) * SLOT_MINUTES;
  const rangeEnd = Math.ceil((max + 30) / SLOT_MINUTES) * SLOT_MINUTES;
  const start = Math.min(TIMETABLE_START_MINUTE, rangeStart);
  const end = Math.max(TIMETABLE_END_MINUTE, rangeEnd);

  return { start, end: Math.max(end, start + SLOT_MINUTES * 2) };
}

function Timetable({ courses, previewCourse }) {
  const coursesForDisplay = useMemo(() => {
    if (!previewCourse) {
      return courses;
    }

    const exists = courses.some((course) => course.id === previewCourse.id);
    if (exists) {
      return courses;
    }

    return [...courses, { ...previewCourse, isPreview: true }];
  }, [courses, previewCourse]);

  const selectedWithSchedule = useMemo(
    () => coursesForDisplay.filter((course) => course.sessions.length > 0),
    [coursesForDisplay]
  );

  const unscheduled = useMemo(
    () => coursesForDisplay.filter((course) => course.sessions.length === 0),
    [coursesForDisplay]
  );

  const bounds = getTimelineRange(selectedWithSchedule);
  const totalSlots = (bounds.end - bounds.start) / SLOT_MINUTES;
  const rowHeight = MIN_ROW_HEIGHT;

  const timeline = useMemo(() => {
    const marks = [];
    for (let t = bounds.start; t <= bounds.end; t += SLOT_MINUTES) {
      marks.push(t);
    }
    return marks;
  }, [bounds.start, bounds.end]);

  const sessionByDay = useMemo(() => {
    const map = { M: [], Tu: [], W: [], Th: [], F: [] };
    selectedWithSchedule.forEach((course) => {
      course.sessions.forEach((session) => {
        const color = colorFromId(course.id);
        map[session.day].push({ ...session, course, color, isPreview: Boolean(course.isPreview) });
      });
    });
    return map;
  }, [selectedWithSchedule]);

  const renderSlots = timeline.map((minute, idx) => (
    <div key={`timeline-${minute}-${idx}`} className="time-row" style={{ height: `${rowHeight}px` }}>
      <div className="time-slot-label">{timeToLabel(minute)}</div>
    </div>
  ));

  return (
    <section className="timetable-card">
      <div className="timetable-head">
        <h2>Selected timetable</h2>
        <p>
          Click a selected course again to unselect. Each selected subject is drawn with
          a unique outline.
        </p>
      </div>

      {coursesForDisplay.length > 0 && selectedWithSchedule.length === 0 ? (
        <p className="empty-state">현재 선택한 과목은 시간이 파싱되지 않아 배치할 수 없습니다.</p>
      ) : null}

      <div className="timetable-wrap">
        <div className="time-axis">{renderSlots}</div>

        {DAY_ORDER.map((day) => (
          <div className="day-column" key={day}>
            <div className="day-header">{DAY_LABELS[day]}</div>
            <div
              className="day-body"
              style={{
                height: `${totalSlots * rowHeight}px`,
                backgroundSize: `100% ${rowHeight}px`,
              }}
            >
              <div className="day-lines">
                {timeline.slice(1).map((_, idx2) => (
                  <span
                    key={`line-${day}-${idx2}`}
                    className="day-line"
                    style={{ top: `${idx2 * rowHeight}px` }}
                  />
                ))}
              </div>

              {sessionByDay[day].map((sessionData, i) => {
                const start = Math.max(sessionData.start, bounds.start);
                const end = Math.min(sessionData.end, bounds.end);
                const isPreview = sessionData.isPreview;
                const bias = getCourseBlockBias(sessionData.course.id);

                if (end <= bounds.start || start >= bounds.end || end <= start) {
                  return null;
                }

                const baseTop = ((start - bounds.start) / SLOT_MINUTES) * rowHeight;
                const baseHeight = ((end - start) / SLOT_MINUTES) * rowHeight;
                const top = baseTop - bias.top;
                const height = baseHeight + bias.top + bias.bottom;
                const leftOffset = 7 - Math.min(6, bias.left);
                const rightOffset = 7 - Math.min(6, bias.right);

                return (
                  <article
                    key={`${sessionData.course.id}-${day}-${i}`}
                    className="course-block"
                    style={{
                      top: `${top}px`,
                      height: `${height}px`,
                      left: `${leftOffset}px`,
                      right: `${rightOffset}px`,
                      borderColor: sessionData.color,
                      borderStyle: isPreview ? "dashed" : "solid",
                      background: isPreview ? "rgba(17, 24, 42, 0.35)" : "rgba(17, 24, 42, 0.55)",
                      boxShadow: isPreview ? "none" : `0 0 0 2px ${sessionData.color}40`,
                      color: sessionData.color,
                      opacity: isPreview ? 0.72 : 1,
                    }}
                  >
                    <strong>{sessionData.course.name}</strong>
                    {isPreview ? <span>미리보기</span> : null}
                    <span>{sessionData.course.code}</span>
                  </article>
                  );
                })}
            </div>
          </div>
        ))}
      </div>

      {unscheduled.length > 0 && (
        <div className="unscheduled-panel">
          <h3>배치되지 않은 과목</h3>
          <ul>
            {unscheduled.map((item) => (
              <li key={`unscheduled-${item.id}`}>{item.name}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default function App() {
  const [activeSchool, setActiveSchool] = useState("UCI");
  const [coursesBySchool, setCoursesBySchool] = useState(null);
  const [selectedBySchool, setSelectedBySchool] = useState(loadFromStorage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mouseUpCourseId, setMouseUpCourseId] = useState(null);
  const [mouseUpTimerId, setMouseUpTimerId] = useState(null);
  const [previewCourseId, setPreviewCourseId] = useState(null);
  const [previewTimerId, setPreviewTimerId] = useState(null);

  useEffect(() => {
    let cancelled = false;

    parseAllData()
      .then((courses) => {
        if (cancelled) {
          return;
        }

        const safe = sanitizeSelectionState(selectedBySchool, courses);
        setSelectedBySchool(safe);
        setCoursesBySchool(courses);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || "데이터를 불러오지 못했습니다.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!coursesBySchool) {
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedBySchool));
  }, [selectedBySchool, coursesBySchool]);

  useEffect(() => {
    return () => {
      if (mouseUpTimerId) {
        clearTimeout(mouseUpTimerId);
      }
      if (previewTimerId) {
        clearTimeout(previewTimerId);
      }
    };
  }, [mouseUpTimerId, previewTimerId]);

  const currentCourses = coursesBySchool?.[activeSchool] ?? [];
  const selectedSet = new Set(selectedBySchool?.[activeSchool] ?? []);
  const visibleCourses = useMemo(() => dedupeCoursesByTime(currentCourses), [currentCourses]);
  const selectedCourses = useMemo(
    () => visibleCourses.filter((course) => selectedSet.has(course.id)),
    [selectedSet, visibleCourses]
  );
  const previewCourse = previewCourseId
    ? visibleCourses.find((course) => course.id === previewCourseId) || null
    : null;

  if (loading) {
    return <main className="app-shell">데이터를 불러오는 중입니다...</main>;
  }

  if (error) {
    return <main className="app-shell error">{error}</main>;
  }

  const toggle = (courseId) => {
    setSelectedBySchool((prev) => {
      const current = new Set(prev[activeSchool] || []);
      if (current.has(courseId)) {
        current.delete(courseId);
      } else {
        current.add(courseId);
      }
      return {
        ...prev,
        [activeSchool]: [...current],
      };
    });
  };

  const handleCourseMouseUp = (courseId) => {
    if (mouseUpTimerId) {
      clearTimeout(mouseUpTimerId);
    }
    if (previewTimerId) {
      clearTimeout(previewTimerId);
    }
    setMouseUpCourseId(courseId);
    setPreviewCourseId(courseId);
    const timerId = setTimeout(() => {
      setMouseUpCourseId((current) => (current === courseId ? null : current));
    }, 180);
    setMouseUpTimerId(timerId);
    const previewTimer = setTimeout(() => {
      setPreviewCourseId((current) => (current === courseId ? null : current));
      setPreviewTimerId(null);
    }, 900);
    setPreviewTimerId(previewTimer);
  };

  return (
    <main className="app-shell">
      <header className="hero">
        <p className="eyebrow">Course Builder</p>
        <h1>3 universities class planner</h1>
        <p className="lead">
          학교별 과목을 비교하고 같은 화면에서 시간표를 확인할 수 있는 간단한 대시보드입니다.
        </p>
      </header>

      <nav className="tabs" aria-label="University tabs">
        {SCHOOL_TABS.map((school) => (
          <button
            type="button"
            key={school.id}
            className={school.id === activeSchool ? "tab tab--active" : "tab"}
            onClick={() => setActiveSchool(school.id)}
          >
            {school.label}
          </button>
        ))}
      </nav>

      <section className="main-grid">
        <aside className="course-list-card">
          <h2>{activeSchool} Courses</h2>
          <p className="subtext">클릭해 과목을 선택하면 시간표에 표시됩니다.</p>
          <div className="course-list">
            {visibleCourses.map((course) => {
              const isSelected = selectedSet.has(course.id);
              const isMouseUp = mouseUpCourseId === course.id;
              return (
                <button
                  type="button"
                  key={course.id}
                  className={`course-item${isSelected ? " active" : ""}${
                    isMouseUp ? " course-item--release" : ""
                  }`}
                  onClick={() => toggle(course.id)}
                  onMouseUp={() => handleCourseMouseUp(course.id)}
                >
                  <span>{course.name}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <Timetable courses={selectedCourses} previewCourse={previewCourse} />
      </section>
    </main>
  );
}
