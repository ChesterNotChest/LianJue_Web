import {
  RAW_ASK_QUESTION_RESPONSE_FOR_USER_7_SYLLABUS_1,
  RAW_GET_PERSONAL_SYLLABUS_DETAIL_INFO_RESPONSE_BY_SYLLABUS_ID_FOR_USER_7,
  RAW_LIST_ALL_SYLLABUSES_BRIEF_INFO_FOR_LEARNING_RESPONSE_FOR_USER_7,
} from './mock_payloads';
import { listSyllabusFiles } from './file_transmit_api';

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseStudentSyllabusListResponse(response) {
  const rows = Array.isArray(response?.syllabuses) ? response.syllabuses : [];

  return rows.map((row) => ({
    syllabusId: row.syllabus_id,
    title: row.title,
    isLearning: Boolean(row.isLearning),
    personalSyllabusPath: row.personal_syllabus_path,
    dayOneTime: row.day_one_time,
  }));
}

function parsePersonalSyllabusResponse(response) {
  return response?.syllabus ?? response?.personal_syllabus ?? null;
}

function parseAskQuestionResponse(response) {
  return {
    answer: response?.answer ?? '',
    matchedFiles: Array.isArray(response?.matched_files) ? response.matched_files : [],
    competanceList: Array.isArray(response?.competance_list) ? response.competance_list : [],
    raw: response?.raw ?? null,
    errorMessage: response?.error_message ?? '',
    errorCode: response?.error_code ?? '',
  };
}

function parseInitPersonalSyllabusResponse(response) {
  return {
    success: Boolean(response?.success),
    syllabusId: response?.syllabus?.syllabus_id ?? null,
    personalSyllabusPath: response?.syllabus?.personal_syllabus_path ?? null,
    errorMessage: response?.error_message ?? '',
    errorCode: response?.error_code ?? '',
  };
}

function parseUpdatePersonalSyllabusResponse(response) {
  return {
    success: Boolean(response?.success),
    syllabus: response?.syllabus ?? null,
    errorMessage: response?.error_message ?? '',
    errorCode: response?.error_code ?? '',
  };
}

function buildRecommendationItems(files, options = {}) {
  const matchedIds = Array.isArray(options.matchedIds) ? options.matchedIds : null;
  const weekIndexes = Array.isArray(options.weekIndexes) ? options.weekIndexes : null;

  return files
    .filter((file) => {
      if (matchedIds?.length) {
        return matchedIds.includes(file.fileId);
      }
      if (weekIndexes?.length) {
        return file.weekIndexList.some((weekIndex) => weekIndexes.includes(Number(weekIndex)));
      }
      return true;
    })
    .map((file) => ({
      fileId: file.fileId,
      title: file.title,
      source: file.source,
      weekLabel: file.weekIndexList.length ? `第 ${file.weekIndexList.join(', ')} 周` : '',
    }));
}

function pickDefaultWeeks(personalSyllabus) {
  const period = Array.isArray(personalSyllabus?.period) ? personalSyllabus.period : [];
  const weakWeeks = period.filter((item) => item.competance === 'weak').map((item) => Number(item.week_index));

  if (weakWeeks.length) {
    return weakWeeks;
  }

  const noneWeeks = period.filter((item) => item.competance === 'none').map((item) => Number(item.week_index));
  return noneWeeks.length ? [noneWeeks[0]] : [];
}

function applyStudyHours(personalSyllabus, weekIndex, studyTimeSpent) {
  const next = cloneData(personalSyllabus);
  const target = (next?.period ?? []).find((item) => String(item.week_index) === String(weekIndex));

  if (!target) {
    return next;
  }

  const hours = Number(studyTimeSpent) || 0;
  let increment = 0;

  if (hours === 1) {
    increment = 2;
  } else if (hours === 2) {
    increment = 4;
  } else if (hours >= 3) {
    increment = 5;
  }

  let progress = Number(target.competance_progress ?? 0) + increment;
  let level = target.competance ?? 'normal';

  if (progress >= 5) {
    if (level === 'weak') {
      level = 'normal';
    } else if (level === 'normal') {
      level = 'master';
    }
    progress = 0;
  } else if (progress <= -5) {
    if (level === 'master') {
      level = 'normal';
    } else if (level === 'normal') {
      level = 'weak';
    }
    progress = 0;
  }

  target.competance = level;
  target.competance_progress = progress;
  target.updated_at = 1775700000;
  next.reviewed_at = 1775700000;

  return next;
}

export async function listStudentSyllabusesRaw() {
  return cloneData(RAW_LIST_ALL_SYLLABUSES_BRIEF_INFO_FOR_LEARNING_RESPONSE_FOR_USER_7);
}

export async function getPersonalSyllabusRaw(syllabusId) {
  return cloneData(RAW_GET_PERSONAL_SYLLABUS_DETAIL_INFO_RESPONSE_BY_SYLLABUS_ID_FOR_USER_7[syllabusId]);
}

export async function askQuestionRaw(payload = {}) {
  return {
    ...cloneData(RAW_ASK_QUESTION_RESPONSE_FOR_USER_7_SYLLABUS_1),
    request: {
      user_id: payload.userId ?? null,
      syllabus_id: payload.syllabusId ?? null,
      question: payload.question ?? '',
    },
  };
}

export async function initPersonalSyllabusRaw(payload = {}) {
  return {
    success: true,
    syllabus: {
      syllabus_id: payload.syllabusId ?? null,
      user_id: payload.userId ?? 7,
      personal_syllabus_path: `./schedule/student_alt/user_${payload.userId ?? 7}/${payload.syllabusId ?? 0}_personal.json`,
    },
    error_message: '',
    error_code: '',
  };
}

export async function updatePersonalSyllabusRaw(payload = {}) {
  const source = cloneData(
    RAW_GET_PERSONAL_SYLLABUS_DETAIL_INFO_RESPONSE_BY_SYLLABUS_ID_FOR_USER_7[payload.syllabusId]?.syllabus ??
      RAW_GET_PERSONAL_SYLLABUS_DETAIL_INFO_RESPONSE_BY_SYLLABUS_ID_FOR_USER_7[1]?.syllabus ??
      null,
  );
  const updated = source ? applyStudyHours(source, payload.weekIndex, payload.studyTimeSpent) : null;

  return {
    success: Boolean(updated),
    syllabus: updated,
    request: payload,
    error_message: updated ? '' : 'not_found',
    error_code: updated ? '' : 'not_found',
  };
}

export async function getStudentDashboardData() {
  const list = parseStudentSyllabusListResponse(await listStudentSyllabusesRaw());

  const syllabuses = await Promise.all(
    list.map(async (item) => {
      const personal = item.personalSyllabusPath ? parsePersonalSyllabusResponse(await getPersonalSyllabusRaw(item.syllabusId)) : null;
      const syllabusFiles = await listSyllabusFiles([item.syllabusId]);
      const defaultWeeks = pickDefaultWeeks(personal);

      return {
        syllabusId: item.syllabusId,
        title: item.title,
        isLearning: item.isLearning,
        dayOneTime: item.dayOneTime,
        personalSyllabus: personal,
        syllabusFiles,
        defaultRecommendations: buildRecommendationItems(syllabusFiles, { weekIndexes: defaultWeeks }),
      };
    }),
  );

  return { syllabuses };
}

export async function initPersonalSyllabus(payload = {}) {
  return parseInitPersonalSyllabusResponse(await initPersonalSyllabusRaw(payload));
}

export async function updatePersonalSyllabus(payload = {}) {
  return parseUpdatePersonalSyllabusResponse(await updatePersonalSyllabusRaw(payload));
}

export async function askQuestion(payload = {}) {
  const parsed = parseAskQuestionResponse(await askQuestionRaw(payload));
  const syllabusFiles = payload.syllabusId ? await listSyllabusFiles([payload.syllabusId]) : [];

  return {
    ...parsed,
    recommendedMaterials: buildRecommendationItems(syllabusFiles, { matchedIds: parsed.matchedFiles }),
  };
}

export {
  parseAskQuestionResponse,
  parseInitPersonalSyllabusResponse,
  parsePersonalSyllabusResponse,
  parseStudentSyllabusListResponse,
  parseUpdatePersonalSyllabusResponse,
};
