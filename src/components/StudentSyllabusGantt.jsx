function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseDateValue(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return startOfDay(value);
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }

  let parsed = null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split('-').map(Number);
    parsed = new Date(year, month - 1, day);
  } else if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    parsed = new Date(text);
  } else if (/^\d{1,2}-\d{1,2}$/.test(text)) {
    const [month, day] = text.split('-').map(Number);
    parsed = new Date(new Date().getFullYear(), month - 1, day);
  } else {
    parsed = new Date(text);
  }

  return Number.isNaN(parsed.getTime()) ? null : startOfDay(parsed);
}

function formatDateLabel(date) {
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
}

function formatShortDateLabel(date) {
  return `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
}

function resolveStartDate(dayOneTime, personalSyllabus) {
  const candidates = [
    dayOneTime,
    personalSyllabus?.day_one,
    personalSyllabus?.period?.find((item) => item?.day_one)?.day_one,
  ];

  for (const candidate of candidates) {
    const parsed = parseDateValue(candidate);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function getCurrentPeriodIndex(startDate, totalPeriods) {
  if (!startDate || !totalPeriods) {
    return null;
  }

  const today = startOfDay(new Date());
  const courseEndDate = addDays(startDate, totalPeriods * 7 - 1);

  if (today < startDate || today > courseEndDate) {
    return null;
  }

  const diffMs = today.getTime() - startDate.getTime();
  return Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
}

function buildTimeline(personalSyllabus, dayOneTime) {
  const source = Array.isArray(personalSyllabus?.period) ? personalSyllabus.period : [];
  const period = [...source].sort((left, right) => Number(left?.week_index ?? 0) - Number(right?.week_index ?? 0));
  const startDate = resolveStartDate(dayOneTime, personalSyllabus);

  if (!period.length || !startDate) {
    return null;
  }

  const totalPeriods = period.length;
  const endDate = addDays(startDate, totalPeriods * 7 - 1);
  const currentPeriodIndex = getCurrentPeriodIndex(startDate, totalPeriods);
  const today = startOfDay(new Date());

  const hasStarted = today >= startDate;
  const isCompleted = today > endDate;
  const pastCount = isCompleted ? totalPeriods : currentPeriodIndex ? Math.max(currentPeriodIndex - 1, 0) : 0;
  const currentItem = currentPeriodIndex ? period[currentPeriodIndex - 1] ?? null : null;
  const currentRangeStart = currentPeriodIndex ? addDays(startDate, (currentPeriodIndex - 1) * 7) : null;
  const currentRangeEnd = currentRangeStart ? addDays(currentRangeStart, 6) : null;

  return {
    startLabel: formatDateLabel(startDate),
    endLabel: formatDateLabel(endDate),
    currentDateLabel: formatDateLabel(today),
    startTick: formatShortDateLabel(startDate),
    endTick: formatShortDateLabel(endDate),
    currentTick: currentRangeStart ? `${formatShortDateLabel(currentRangeStart)} - ${formatShortDateLabel(currentRangeEnd)}` : isCompleted ? '已完成' : hasStarted ? '--' : '未开始',
    currentTitle: String(currentItem?.enhanced_content ?? currentItem?.content ?? '').trim(),
    statusLabel: isCompleted ? '课程进度已完成' : hasStarted ? '当前学习日期' : '课程尚未开始',
    pastWidth: `${(pastCount / totalPeriods) * 100}%`,
    currentWidth: currentPeriodIndex && !isCompleted ? `${100 / totalPeriods}%` : '0%',
  };
}

export default function StudentSyllabusGantt({ personalSyllabus, dayOneTime }) {
  const timeline = buildTimeline(personalSyllabus, dayOneTime);

  if (!timeline) {
    return (
      <div className="student-data-refusal">
        <p>暂无数据</p>
      </div>
    );
  }

  return (
    <div className="student-syllabus-gantt-lite">
      <div className="student-syllabus-gantt-head">
        <div className="student-syllabus-gantt-meta">
          <span>开始日期 {timeline.startLabel}</span>
          <span>结束日期 {timeline.endLabel}</span>
        </div>
        <div className="student-syllabus-gantt-meta">
          <span>今天 {timeline.currentDateLabel}</span>
          <span>{timeline.statusLabel} {timeline.currentTick}</span>
        </div>
      </div>

      <div className="student-syllabus-gantt-rail">
        <div className="student-syllabus-gantt-glow" />
        <div className="student-syllabus-gantt-track">
          <div className="student-syllabus-gantt-fill is-past" style={{ width: timeline.pastWidth }} />
          <div className="student-syllabus-gantt-fill is-current" style={{ left: timeline.pastWidth, width: timeline.currentWidth }} />
        </div>
      </div>

      <div className="student-syllabus-gantt-scale">
        <span>{timeline.startTick}</span>
        <span>{timeline.currentTick}</span>
        <span>{timeline.endTick}</span>
      </div>
    </div>
  );
}
